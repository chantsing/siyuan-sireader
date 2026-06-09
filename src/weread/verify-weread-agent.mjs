const endpoint = 'https://i.weread.qq.com/api/agent/gateway'
const apiKey = process.env.WEREAD_API_KEY || ''

const call = async (key) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_name: '/store/search',
      skill_version: '1.0.3',
      keyword: '三体',
      scope: 10,
      count: 3,
    }),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: response.status, json, text: text.slice(0, 500) }
}

const result = await call(apiKey)

if (!apiKey) {
  console.log('WEREAD_API_KEY not set; checked unauthenticated gateway path.')
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.status > 0 ? 0 : 1)
}

const books = []
for (const group of Array.isArray(result.json?.results) ? result.json.results : []) {
  if (Array.isArray(group.books)) books.push(...group.books)
}
if (Array.isArray(result.json?.books)) books.push(...result.json.books)

console.log(JSON.stringify({
  status: result.status,
  errcode: result.json?.errcode,
  errmsg: result.json?.errmsg,
  bookCount: books.length,
  firstBook: books[0]?.bookInfo || books[0]?.book || books[0] || null,
}, null, 2))

process.exit(result.status === 200 && (!result.json?.errcode || result.json.errcode === 0) && books.length ? 0 : 1)
