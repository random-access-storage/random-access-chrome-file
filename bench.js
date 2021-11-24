const createFile = require('./')

const st = createFile('benchmark.txt')
st.open(tinyWrites)

function tinyWrites () {
  let offset = 0
  const buf = Buffer.alloc(1)
  console.time('10000 tiny writes')
  st.write(0, buf, function onwrite (err) {
    if (err) throw err
    offset++
    if (offset === 10000) {
      console.timeEnd('10000 tiny writes')
      return tinyReads()
    }
    st.write(offset, buf, onwrite)
  })
}

function tinyReads () {
  let offset = 0
  console.time('10000 tiny reads')
  st.read(0, 1, function onread (err) {
    if (err) throw err
    offset++
    if (offset === 10000) {
      console.timeEnd('10000 tiny reads')
      return benchWrite()
    }
    st.read(offset, 1, onread)
  })
}

function benchRead () {
  let offset = 0
  console.time('512mb read')
  st.read(0, 65536, function onread (err, buf) {
    if (err) throw err
    if (offset >= 512 * 1024 * 1024) return console.timeEnd('512mb read')
    st.read(offset += buf.length, 65536, onread)
  })
}

function benchWrite () {
  let offset = 0
  const buf = Buffer.alloc(65536).fill('hi')
  console.time('512mb write')
  st.write(offset, buf, function onwrite (err) {
    if (err) throw err
    if (offset >= 512 * 1024 * 1024) {
      console.timeEnd('512mb write')
      benchRead()
      return
    }
    st.write(offset += buf.length, buf, onwrite)
  })
}
