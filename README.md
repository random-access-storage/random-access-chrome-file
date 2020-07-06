# random-access-chrome-file

[![Build Status](https://travis-ci.com/random-access-storage/random-access-chrome-file.svg?branch=master)](https://travis-ci.com/random-access-storage/random-access-chrome-file)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

A [random-access-storage](https://github.com/random-access-storage/random-access-storage) instance backed by the Chrome file system api

```
npm install random-access-chrome-file
```

## Usage

``` js
// Currently only works in Chrome

const createFile = require('random-access-chrome-file')

const file = createFile('test.txt')

file.write(0, Buffer.from('hello world'), function (err) {
  if (err) throw err
  file.read(0, 11, function (err, buf) {
    if (err) throw err
    console.log(buf.toString())
  })
})
```

## API

#### `file = createFile(name, [options])`

Returns a [random-access-storage](https://github.com/random-access-storage/random-access-storage) instance that supports
the full API.

Options include:

```js
{
  maxSize: Number.MAX_SAFE_INTEGER
}
```

`maxSize` is the storage quota it asks the browser for. If you are making an extension you can set the `unlimitedStorage`
to get all the storage you want. Otherwise tweak the `maxSize` option to fit your needs.

If you want to change the `maxSize` default for all instances change `createFile.DEFAULT_MAX_SIZE`.

#### `createFile.requestQuota(maxSize, cb)`

Manually request the `maxSize` quota without creating af file.

## License

MIT
