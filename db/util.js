import lexint from 'lexicographic-integer-encoding'
import { publicServerDb, publicUserDbs, privateUserDbs } from '../db/index.js'
import { constructUserUrl, parseEntryUrl, hyperUrlToKeyStr } from '../lib/strings.js'
import { fetchUserId } from '../lib/network.js'

const lexintEncoder = lexint('hex')

export async function fetchAuthor (authorId, cache = undefined) {
  if (cache && cache[authorId]) {
    return cache[authorId]
  } else {
    let publicUserDb = publicUserDbs.get(authorId)
    let profileEntry
    if (publicUserDb) profileEntry = await publicUserDb.profile.get('self')
    let author = {
      url: constructUserUrl(authorId),
      userId: authorId,
      displayName: profileEntry?.value?.displayName || authorId
    }
    if (cache) cache[authorId] = author
    return author
  }
}

export async function fetchFollowerIds (subjectUserId, userIdxId = undefined) {
  let followsServerIdxEntry
  let followsUserIdxEntry
  try {
    followsServerIdxEntry = await publicServerDb.followsIdx.get(subjectUserId)
    if (userIdxId && privateUserDbs.has(userIdxId)) {
      followsUserIdxEntry = await privateUserDbs.get(userIdxId).followsIdx.get(subjectUserId)
    }
  } catch (e) {}
  return concatUniq(followsServerIdxEntry?.value?.followerIds, followsUserIdxEntry?.value?.followerIds)
}

export async function fetchVotes (subjectUrl, userIdxId = undefined) {
  let votesServerIdxEntry
  let votesUserIdxEntry
  votesServerIdxEntry = await publicServerDb.votesIdx.get(subjectUrl)
  if (userIdxId && privateUserDbs.has(userIdxId)) {
    votesUserIdxEntry = await privateUserDbs.get(userIdxId).votesIdx.get(subjectUrl)
  }

  const upvoteUrls = concatUniq(votesServerIdxEntry?.value?.upvoteUrls, votesUserIdxEntry?.value?.upvoteUrls)
  const downvoteUrls = concatUniq(votesServerIdxEntry?.value?.downvoteUrls, votesUserIdxEntry?.value?.downvoteUrls)
  return {
    subject: votesServerIdxEntry?.subject || votesUserIdxEntry?.subject || {dbUrl: subjectUrl},
    upvoterIds: await Promise.all(upvoteUrls.map(fetchUserId)),
    downvoterIds: await Promise.all(downvoteUrls.map(fetchUserId))
  }
}

export async function fetchComments (subject, userIdxId = undefined) {
  let commentsServerIdxEntry
  let commentsUserIdxEntry
  
  commentsServerIdxEntry = await publicServerDb.commentsIdx.get(subject.url)
  if (userIdxId && privateUserDbs.has(userIdxId)) {
    commentsUserIdxEntry = await privateUserDbs.get(userIdxId).commentsIdx.get(subject.url)
  }

  let comments = concat(commentsServerIdxEntry?.value.comments, commentsUserIdxEntry?.value.comments)
  comments = comments.filter((comment, index) => {
    return comments.findIndex(comment2 => comment2.dbUrl === comment.dbUrl) === index
  })
  return comments
}

export async function fetchCommentCount (subject, userIdxId = undefined) {
  const comments = await fetchComments(subject, userIdxId)
  return comments.length
}

export async function fetchNotications (userInfo, {after, before} = {}) {
  let notificationServerIdxEntries
  let notificationUserIdxEntries

  const ltKey = before ? lexintEncoder.encode(Number(new Date(before))) : undefined
  const gtKey = after ? lexintEncoder.encode(Number(new Date(after))) : undefined
  const dbKey = hyperUrlToKeyStr(userInfo.dbUrl)
  notificationServerIdxEntries = await publicServerDb.notificationIdx.list({
    lt: ltKey ? `${dbKey}:${ltKey}` : `${dbKey}:\xff`,
    gt: gtKey ? `${dbKey}:${gtKey}` : `${dbKey}:\x00`,
    limit: 20,
    reverse: true
  })
  if (privateUserDbs.has(userInfo.userId)) {
    notificationUserIdxEntries = await privateUserDbs.get(userInfo.userId).notificationsIdx.list({
      lt: ltKey ? ltKey : undefined,
      gt: gtKey ? gtKey : undefined,
      limit: 20,
      reverse: true
    })
  }

  let notificationEntries = concat(notificationServerIdxEntries, notificationUserIdxEntries)
  notificationEntries = notificationEntries.filter((entry, index) => {
    return notificationEntries.findIndex(entry2 => entry2.value.itemUrl === entry.value.itemUrl) === index
  })
  return await Promise.all(notificationEntries.map(fetchNotification))
}

export async function countNotications (userInfo, {after, before} = {}) {
  let notificationServerIdxEntries
  let notificationUserIdxEntries

  const ltKey = before ? lexintEncoder.encode(Number(new Date(before))) : undefined
  const gtKey = after ? lexintEncoder.encode(Number(new Date(after))) : undefined
  const dbKey = hyperUrlToKeyStr(userInfo.dbUrl)
  notificationServerIdxEntries = await publicServerDb.notificationIdx.list({
    lt: ltKey ? `${dbKey}:${ltKey}` : `${dbKey}:\xff`,
    gt: gtKey ? `${dbKey}:${gtKey}` : `${dbKey}:\x00`,
    limit: 20,
    reverse: true
  })
  if (privateUserDbs.has(userInfo.userId)) {
    notificationUserIdxEntries = await privateUserDbs.get(userInfo.userId).notificationsIdx.list({
      lt: ltKey ? ltKey : undefined,
      gt: gtKey ? gtKey : undefined,
      limit: 20,
      reverse: true
    })
  }

  let notificationEntries = concat(notificationServerIdxEntries, notificationUserIdxEntries)
  notificationEntries = notificationEntries.filter((entry, index) => {
    return notificationEntries.findIndex(entry2 => entry2.value.itemUrl === entry.value.itemUrl) === index
  })
  return notificationEntries.length
}

async function fetchNotification (notificationEntry) {
  const itemUrlp = parseEntryUrl(notificationEntry.value.itemUrl)
  const userId = await fetchUserId(itemUrlp.origin)
  const db = publicUserDbs.get(userId)
  let item
  if (db) {
    item = await db.getTable(itemUrlp.schemaId).get(itemUrlp.key)
  }
  return {
    itemUrl: notificationEntry.value.itemUrl,
    createdAt: notificationEntry.value.createdAt,
    author: {
      userId,
      url: constructUserUrl(userId)
    },
    item: item?.value
  }
}


function concatUniq (...args){
  return Array.from(new Set(concat(...args)))
}

function concat (...args) {
  let arr = []
  for (let item of args) {
    if (item) arr = arr.concat(item)
  }
  return arr
}