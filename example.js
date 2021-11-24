const createFile = require('./')

const st = createFile('/some/folder/hello-world.txt')
let missing = 2

st.write(0, Buffer.from('hello '), done)
st.write(6, Buffer.from('world'), done)

function done (err) {
  if (err) throw err
  if (!--missing) st.read(0, 11, (_, buf) => console.log(buf.toString()))
}
