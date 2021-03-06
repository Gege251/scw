const fs       = require('fs-extra')
const path     = require('path')
const chokidar = require('chokidar')
const dp       = require('./utils/deployconf-manager')
const ch       = require('./utils/change-manager')
const msg      = require('./lang/lang.js').messages
const logger   = new (require('./utils/logger'))()
const log      = logger.log

module.exports = watcher

async function watcher(wdir) {
  return new Promise(async (resolveApp) => {
    let watchers
    let jobs = []

    if (! dp.exists(wdir)) {
      console.log(msg.ERR_NO_PROJECT)
      resolveApp(false)
    }
    const dpConf = await dp.read(wdir)

    logger.setLogFile(dpConf.logging ? path.join(wdir, 'changes.log') : null)

    const changesConf = await ch.read(wdir)
    const changes = changesConf.changes

    if (changes.length < 1) {
      console.log(msg.ERR_CHANGE_EMPTY)
      resolveApp()
      return
    }

    if (changesConf.lock) {
      console.log(msg.ERR_LOCKED)
      resolveApp()
      return
    }


    watchers = changes.map(change => {
      return {
          file: change,
          watcher: chokidar.watch(path.join(dpConf.source, change.path, change.filename))
            .on('change', watchedFile => onChange(change, dpConf, changesConf))
      }
    })


    try {
      console.log(msg.MSG_WATCHING_START, dpConf.source)

      // Reading user input
      process.stdin.setEncoding('utf8')
      process.stdin.on('readable', () => {
        jobs.push(new Promise(async (resolveJob) => {

          const chunk = process.stdin.read()
          if (chunk) {

            const args = chunk.split(/[\s\n]/).filter(e => e)

            if (['list', 'ls'].includes(args[0])) {
              (require('./list.js'))(wdir)
                .then(() => {
                  resolveJob()
                })
            }

            else if (['add', '+'].includes(args[0])) {
              (require('./add-to-change'))(wdir, args[1])
                .then(result => {
                  if (result) {

                    let change =
                      changes.find(ch => 
                        ch.filename === path.basename(args[1]) && ch.path === path.dirname(args[1]))

                    watchers.push({
                      file: change,
                      watcher: chokidar.watch(path.join(dpConf.source, args[1]))
                        .on('change', watchedFile => onChange(change, dpConf, changesConf))
                    })
                    console.log(msg.MSG_WATCHING_ADDED)
                    resolveJob()
                  }
                })
            }

            else if (['remove', '-'].includes(args[0])) {
              (require('./remove-from-change'))(wdir, args[1])
                .then(result => {
                  if (result) {
                    let change = {
                      path: path.dirname(args[1]),
                      filename: path.basename(args[1])
                    }
                    const wrIndex = watchers.findIndex(e => e.file.filename === change.filename && e.file.path === change.path)
                    const chIndex = changes.findIndex(chf => chf.filename === change.filename && chf.path === change.path)
                    watchers[wrIndex].watcher.close()
                    watchers.splice(wrIndex, 1)
                    changes.splice(chIndex, 1)
                    console.log(msg.MSG_WATCHING_REMOVED)
                    resolveJob()
                  }
              })
            }

            else if (args[0] === 'exit') {
              await Promise.all(jobs)
              resolveApp()
              process.stdin.end()
            }

            else {
              resolveJob()
            }
          } else {
            resolveJob()
          }
        }))
      })
    } catch(e) {
      console.log(msg.ERR_NO_PROJECT)
    }
    
    async function onChange(change, dpConf, changesConf) {

      try {
        jobs.push(new Promise(async (resolveJob) => {
          await fs.copy(path.join(dpConf.source, change.path, change.filename),
                  path.join(wdir, dpConf.editedVersion, change.path, change.filename))
          log(change.filename + ' ' + msg.MSG_SAVED)
          await ch.updateFile(wdir, path.join(change.path, change.filename))
          log(msg.MSG_CHANGES_UPDATED)
          resolveJob()
        }))
      } catch(e) { 
        log(msg.ERR_FILE_RW)
      }
    }
  })
    

}
