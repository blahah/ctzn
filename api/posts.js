import createMlts from 'monotonic-lexicographic-timestamp'
import { createValidator } from '../lib/schemas.js'
import { publicUserDbs } from '../db/index.js'
import { constructEntryUrl, parseEntryUrl } from '../lib/strings.js'
import { fetchUserId } from '../lib/network.js'
import { fetchAuthor, fetchVotes, fetchCommentCount } from '../db/util.js'
import { getPost, listPosts } from '../db/getters.js'

const mlts = createMlts()

const listParam = createValidator({
  type: 'object',
  additionalProperties: false,
  properties: {
    lt: {type: 'string'},
    lte: {type: 'string'},
    gt: {type: 'string'},
    gte: {type: 'string'},
    reverse: {type: 'boolean'},
    limit: {type: 'number'}
  }
})

export function setup (wsServer) {
  wsServer.register('posts.listFeaturedFeed', async params => {
    return 'todo'
  })

  wsServer.register('posts.listUserFeed', async ([userId, opts], client) => {
    if (opts) {
      listParam.assert(opts)
    }
    opts = opts || {}
    opts.limit = opts.limit && typeof opts.limit === 'number' ? opts.limit : 100
    opts.limit = Math.max(Math.min(opts.limit, 100), 1)

    userId = await fetchUserId(userId)
    const publicUserDb = publicUserDbs.get(userId)
    if (!publicUserDb) throw new Error('User database not found')

    return listPosts(publicUserDb, opts, userId, client.auth)
  })

  wsServer.register('posts.listHomeFeed', async ([opts], client) => {
    // TODO add pagination. For now, just return nothing when more results are requested.
    if (opts?.lt) return []

    if (!client?.auth) throw new Error('Must be logged in')
    const publicUserDb = publicUserDbs.get(client.auth.userId)
    if (!publicUserDb) throw new Error('User database not found')

    const followEntries = await publicUserDb.follows.list()
    followEntries.unshift({value: {subject: client.auth}})
    let postEntries = (await Promise.all(followEntries.map(async followEntry => {
      const followedUserDb = publicUserDbs.get(followEntry.value.subject.userId)
      if (!followedUserDb) return []
      
      const entries = await followedUserDb.posts.list({limit: 10, reverse: true})
      for (let entry of entries) {
        entry.author = followEntry.value.subject
        entry.url = constructEntryUrl(followEntry.value.subject.dbUrl, 'ctzn.network/post', entry.key)
      }
      return entries
    }))).flat()

    postEntries.sort((a, b) => Number(new Date(b.value.createdAt)) - Number(new Date(a.value.createdAt)))
    postEntries = postEntries.slice(0, 100)

    const authorsCache = {}
    for (let entry of postEntries) {
      entry.author = await fetchAuthor(entry.author.userId, authorsCache)
      entry.votes = await fetchVotes(entry.dbUrl, client?.auth?.userId)
      entry.commentCount = await fetchCommentCount(entry, client?.auth?.userId)
    }

    return postEntries
  })

  wsServer.register('posts.get', async ([userId, key], client) => {
    if (!key && userId) {
      let parsed = parseEntryUrl(userId)
      if (parsed.schemaId !== 'ctzn.network/post') {
        throw new Error('Not a post URL')
      }
      userId = await fetchUserId(parsed.origin)
      key = parsed.key
    }

    const publicUserDb = publicUserDbs.get(userId)
    if (!publicUserDb) throw new Error('User database not found')

    return getPost(publicUserDb, key, userId, client.auth)
  })

  wsServer.register('posts.create', async ([post], client) => {
    if (!client?.auth) throw new Error('Must be logged in')
    const publicUserDb = publicUserDbs.get(client.auth.userId)
    if (!publicUserDb) throw new Error('User database not found')

    const key = mlts()
    post.createdAt = (new Date()).toISOString()
    await publicUserDb.posts.put(key, post)
    
    const url = constructEntryUrl(publicUserDb.url, 'ctzn.network/post', key)
    return {key, url}
  })

  wsServer.register('posts.edit', async ([key, post], client) => {
    if (!client?.auth) throw new Error('Must be logged in')
    const publicUserDb = publicUserDbs.get(client.auth.userId)
    if (!publicUserDb) throw new Error('User database not found')

    const postEntry = await publicUserDb.posts.get(key)
    if (!postEntry) {
      throw new Error('Post not found')
    }

    postEntry.value.text = post?.text
    await publicUserDb.posts.put(key, postEntry.value)

    const url = constructEntryUrl(publicUserDb.url, 'ctzn.network/post', postEntry.key)
    return {key, url}
  })

  wsServer.register('posts.del', async ([key], client) => {
    if (!client?.auth) throw new Error('Must be logged in')
    const publicUserDb = publicUserDbs.get(client.auth.userId)
    if (!publicUserDb) throw new Error('User database not found')

    await publicUserDb.posts.del(key)
  })
}