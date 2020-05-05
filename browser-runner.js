const puppeteer = require('puppeteer')
const budo = require('budo')
const tapFinished = require('tap-finished')
const { PassThrough, pipeline } = require('stream')

const args = process.argv.slice(2)

budo.cli(args, { live: false, watchGlob: '', stream: false }).on('connect', runTests)

async function runTests (ev) {
  const results = new PassThrough()
  let browser
  let page

  try {
    browser = await puppeteer.launch()
    page = await browser.newPage()
  } catch (err) {
    console.error(err)
    shutdown(1)
  }

  page.on('error', async err => {
    console.error(err)
    shutdown(1)
  })

  page.on('pageerror', async err => {
    console.error(err)
    shutdown(1)
  })

  page.on('console', msg => {
    msg = msg.text()
    if (msg.includes('BROWSER_RUNNER_EXIT')) {
      shutdown()
    } else {
      results.push(`${msg}\n`)
    }
  })

  pipeline(results, tapFinished(result => {
    shutdown(result.ok ? 0 : 1)
  }), () => {})

  pipeline(results, process.stdout, () => {})

  await page.goto(`http://localhost:${ev.port}`)

  async function shutdown (code = 0) {
    if (browser) {
      await browser.close().catch(() => {})
    }

    process.exit(code)
  }
}
