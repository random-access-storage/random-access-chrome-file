const createFile = require('./')

const st = createFile('benchmark.txt')
st.open(benchWrite)

function benchRead () {
  var offset = 0
  console.time('512mb read')
  st.read(0, 65536, function onread (err, buf) {
    if (err) throw err
    if (offset >= 512 * 1024 * 1024) return console.timeEnd('512mb read')
    st.read(offset += buf.length, 65536, onread)
  })
}

function benchWrite () {
  var offset = 0
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
