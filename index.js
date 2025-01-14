// test
const { execSync, spawn } = require('child_process')
const { existsSync } = require('fs')
const { EOL } = require('os')
const path = require('path')

// Change working directory if user defined PACKAGEJSON_DIR
if (process.env.PACKAGEJSON_DIR) {
  process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PACKAGEJSON_DIR}`
  process.chdir(process.env.GITHUB_WORKSPACE)
}

const workspace = process.env.GITHUB_WORKSPACE;

(async () => {
  const pkg = getPackageJson()

  const tagPrefix = process.env['INPUT_TAG-PREFIX'] || ''

  const commitMessage = process.env['INPUT_COMMIT-MESSAGE'] || 'CI: version bump to {{version}}'

  // get default version bump
  let version = process.env.BUMP_VERSION

  console.log('version action:', version)

  // GIT logic
  try {
    const current = pkg.version.toString()
    // set git user
    await runInWorkspace('git', ['config', 'user.name', `"${process.env.GITHUB_USER || 'Version Bump'}"`])
    await runInWorkspace('git', [
      'config',
      'user.email',
      `"${process.env.GITHUB_EMAIL || 'gh-action-bump-version@users.noreply.github.com'}"`
    ])

    let currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1]
    let isPullRequest = false
    if (process.env.GITHUB_HEAD_REF) {
      // Comes from a pull request
      currentBranch = process.env.GITHUB_HEAD_REF
      isPullRequest = true
    }
    if (process.env['INPUT_TARGET-BRANCH']) {
      // We want to override the branch that we are pulling / pushing to
      currentBranch = process.env['INPUT_TARGET-BRANCH']
    }
    console.log('currentBranch:', currentBranch)
    // do it in the current checked out github branch (DETACHED HEAD)
    // important for further usage of the package.json version
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', current])
    console.log('current:', current, '/', 'version:', version)
    let newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '')
    newVersion = `${tagPrefix}${newVersion}`
    if (process.env['INPUT_SKIP-COMMIT'] !== 'true') {
      await runInWorkspace('git', ['commit', '-a', '-m', commitMessage.replace(/{{version}}/g, newVersion)])
    }

    // now go to the actual branch to perform the same versioning
    if (isPullRequest) {
      // First fetch to get updated local version of branch
      await runInWorkspace('git', ['fetch'])
    }
    await runInWorkspace('git', ['checkout', currentBranch])
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', current])
    console.log('current:', current, '/', 'version:', version)
    newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '')
    newVersion = `${tagPrefix}${newVersion}`
    console.log(`::set-output name=newTag::${newVersion}`)
    try {
      // to support "actions/checkout@v1"
      if (process.env['INPUT_SKIP-COMMIT'] !== 'true') {
        await runInWorkspace('git', ['commit', '-a', '-m', commitMessage.replace(/{{version}}/g, newVersion)])
      }
    } catch (e) {
      console.warn(
        'git commit failed because you are using "actions/checkout@v2"; ' +
          'but that doesnt matter because you dont need that git commit, thats only for "actions/checkout@v1"'
      )
    }

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`
    if (process.env['INPUT_SKIP-TAG'] !== 'true') {
      await runInWorkspace('git', ['tag', newVersion])
      if (process.env['INPUT_SKIP-PUSH'] !== 'true') {
        await runInWorkspace('git', ['push', remoteRepo, '--follow-tags'])
        await runInWorkspace('git', ['push', remoteRepo, '--tags'])
      }
    } else {
      if (process.env['INPUT_SKIP-PUSH'] !== 'true') {
        await runInWorkspace('git', ['push', remoteRepo])
      }
    }
  } catch (e) {
    logError(e)
    exitFailure('Failed to bump version')
    return
  }
  exitSuccess('Version bumped!')
})()

function getPackageJson () {
  const pathToPackage = path.join(workspace, 'package.json')
  if (!existsSync(pathToPackage)) throw new Error("package.json could not be found in your project's root.")
  return require(pathToPackage)
}

function exitSuccess (message) {
  console.info(`✔  success   ${message}`)
  process.exit(0)
}

function exitFailure (message) {
  logError(message)
  process.exit(1)
}

function logError (error) {
  console.error(`✖  fatal     ${error.stack || error}`)
}

function runInWorkspace (command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace })
    let isDone = false
    const errorMessages = []
    child.on('error', (error) => {
      if (!isDone) {
        isDone = true
        reject(error)
      }
    })
    child.stderr.on('data', (chunk) => errorMessages.push(chunk))
    child.on('exit', (code) => {
      if (!isDone) {
        if (code === 0) {
          resolve()
        } else {
          reject(`${errorMessages.join('')}${EOL}${command} exited with code ${code}`)
        }
      }
    })
  })
  // return execa(command, args, { cwd: workspace });
}
