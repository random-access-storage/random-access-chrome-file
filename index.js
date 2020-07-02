const ras = require('random-access-storage')
const mutexify = require('mutexify')

const TYPE = {type: 'octet/stream'}
const requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem
const persistentStorage = navigator.persistentStorage || navigator.webkitPersistentStorage
const FileReader = window.FileReader
const Blob = window.Blob

createFile.DEFAULT_MAX_SIZE = Number.MAX_SAFE_INTEGER
createFile.requestQuota = requestQuota

module.exports = createFile

function requestQuota (n, force, cb) {
  if (typeof force === 'function') return requestQuota(n, true, force)
  persistentStorage.queryUsageAndQuota(function (used, quota) {
    if (quota && !force) return cb(null, quota)
    persistentStorage.requestQuota(n, function (quota) {
      cb(null, quota)
    }, cb)
  }, cb)
}

function createFile (name, opts) {
  if (!opts) opts = {}

  const maxSize = opts.maxSize || createFile.DEFAULT_MAX_SIZE
  const mutex = new Mutex()

  var fs = null
  var entry = null
  var file = null
  var toDestroy = null
  var readers = []
  var writers = []

  return ras({read, write, open, stat, close, destroy})

  function read (req) {
    const r = readers.pop() || new ReadRequest(readers, entry, file, mutex)
    r.run(req)
  }

  function write (req) {
    const w = writers.pop() || new WriteRequest(writers, entry, file, mutex)
    w.run(req)
  }

  function close (req) {
    readers = writers = entry = fs = null
    req.callback(null)
  }

  function stat (req) {
    file.get((err, file) => {
      if (err) return req.callback(err)
      req.callback(null, file)
    })
  }

  function destroy (req) {
    toDestroy.remove(ondone, onerror)

    function ondone () {
      toDestroy = null
      req.callback(null, null)
    }

    function onerror (err) {
      toDestroy = null
      req.callback(err, null)
    }
  }

  function open (req) {
    requestQuota(maxSize, false, function (err, granted) {
      if (err) return onerror(err)
      requestFileSystem(window.PERSISTENT, granted, function (res) {
        fs = res
        mkdirp(parentFolder(name), function () {
          fs.root.getFile(name, {create: true}, function (e) {
            entry = toDestroy = e
            file = new EntryFile(entry)
            file.get((err) => {
              if (err) return onerror(err)
              req.callback(null)
            })
          }, onerror)
        })
      }, onerror)
    })

    function mkdirp (name, ondone) {
      if (!name) return ondone()
      fs.root.getDirectory(name, {create: true}, ondone, function () {
        mkdirp(parentFolder(name), function () {
          fs.root.getDirectory(name, {create: true}, ondone, ondone)
        })
      })
    }

    function onerror (err) {
      fs = entry = null
      req.callback(err)
    }
  }
}

function parentFolder (path) {
  const i = path.lastIndexOf('/')
  const j = path.lastIndexOf('\\')
  const p = path.slice(0, Math.max(0, i, j))
  return /^\w:$/.test(p) ? '' : p
}

function WriteRequest (pool, entry, file, mutex) {
  this.pool = pool
  this.entry = entry
  this.file = file
  this.mutex = mutex
  this.writer = null
  this.req = null
  this.locked = false
  this.truncating = false
}

WriteRequest.prototype.makeWriter = function () {
  const self = this
  this.entry.createWriter(function (writer) {
    self.writer = writer

    writer.onwriteend = function (e) {
      self.onwrite(null, e)
    }

    writer.onerror = function (err) {
      self.onwrite(err)
    }

    self.run(self.req)
  })
}

WriteRequest.prototype.onwrite = function (err, e) {
  const req = this.req
  this.req = null

  if (this.locked) {
    this.locked = false
    this.mutex.release()
  }

  if (!err) {
    this.file.updateSize(e.currentTarget.length)
  }

  if (this.truncating) {
    this.truncating = false
    if (!err) return this.run(req)
  }

  this.pool.push(this)
  req.callback(err, null)
}

WriteRequest.prototype.truncate = function () {
  this.truncating = true
  this.file.truncate()
  this.writer.truncate(this.req.offset)
}

WriteRequest.prototype.lock = function () {
  if (this.locked) return true
  this.locked = this.mutex.lock(this)
  return this.locked
}

WriteRequest.prototype.run = function (req) {
  this.file.getWritableFile((err, file) => {
    if (err) return req.callback(err)

    this.req = req
    if (!this.writer || this.writer.length !== file.size) return this.makeWriter()

    const end = req.offset + req.size
    if (end > file.size && !this.lock()) return

    if (req.offset > this.writer.length) {
      if (req.offset > file.size) return this.truncate()
      return this.makeWriter()
    }

    this.writer.seek(req.offset)
    this.writer.write(new Blob([req.data], TYPE))
  })
}

function Mutex () {
  this.queued = null
}

Mutex.prototype.release = function () {
  const queued = this.queued
  this.queued = null
  for (var i = 0; i < queued.length; i++) {
    queued[i].run(queued[i].req)
  }
}

Mutex.prototype.lock = function (req) {
  if (this.queued) {
    this.queued.push(req)
    return false
  }
  this.queued = []
  return true
}

function ReadRequest (pool, entry, file, mutex) {
  this.pool = pool
  this.entry = entry
  this.file = file
  this.mutex = mutex
  this.reader = new FileReader()
  this.req = null
  this.retry = true
  this.locked = false

  const self = this

  this.reader.onerror = function () {
    self.onread(this.error, null)
  }

  this.reader.onload = function () {
    const buf = Buffer.from(this.result)
    self.onread(null, buf)
  }
}

ReadRequest.prototype.lock = function () {
  if (this.locked) return true
  this.locked = this.mutex.lock(this)
  return this.locked
}

ReadRequest.prototype.onread = function (err, buf) {
  const req = this.req

  if (err && this.retry) {
    if (err.code !== 0) {
      this.retry = false
    }

    if (this.lock(this)) {
      this.file.clearFile()
      this.run(req)
    }
    return
  }

  this.req = null
  this.pool.push(this)
  this.retry = true

  if (this.locked) {
    this.locked = false
    this.mutex.release()
  }

  req.callback(err, buf)
}

ReadRequest.prototype.run = function (req) {
  this.file.get((err, file) => {
    if (err) return req.callback(err)

    const end = req.offset + req.size
    this.req = req
    if (end > file.size) return this.onread(new Error('Could not satisfy length'), null)
    this.reader.readAsArrayBuffer(file.slice(req.offset, end))
  })
}

class EntryFile {
  constructor (entry) {
    this._entry = entry
    this._lock = mutexify()
    this._file = null
    this._size = 0
    this._truncated = false
  }

  get size () {
    return this._size
  }

  updateSize (size) {
    if (!this._truncated && size > this._size) {
      this._size = size
    }

    this.clearFile()
  }

  truncate () {
    this._truncated = true
  }

  clearFile () {
    this._file = null
  }

  get (cb) {
    if (this._file && !this._truncated) {
      return cb(null, this._file)
    }

    this._lock(release => {
      if (this._file && !this._truncated) {
        return release(cb, null, this._file)
      }

      this._entry.file(file => {
        this._truncated = false
        this._file = file
        this._size = file.size
        release(cb, null, file)
      }, err => release(cb, err))
    })
  }

  getWritableFile (cb) {
    if (!this._truncated) {
      return cb(null, this)
    }

    this.get(cb)
  }
}
