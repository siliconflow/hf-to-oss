import * as core from '@actions/core'
const git = require('isomorphic-git')
const fs = require('fs')
import * as path from 'path'
import axios from 'axios'
import OSS from 'ali-oss'
import * as stream from 'stream'
const PassThrough = stream.PassThrough
import * as _ from 'lodash'

const client = new OSS({
  region: 'oss-cn-beijing',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID as string,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET as string,
  bucket: 'hf-sync'
})

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */

function extractURL(url: string): { repo: string; ref: string; file: string } {
  const regex = /huggingface.co\/(.+?\/.+?)\/resolve\/(.+?)\/(.+)/
  const match = url.match(regex)
  if (match) {
    return { repo: match[1], ref: match[2], file: match[3] }
  } else {
    throw new Error('Invalid repository URL')
  }
}

const MAX_JOBS = 256

type DownloadURL = string
type DownloadTask = {
  urls: string
  id: string
  size: number
}

type DownloadMatrix = {
  task: DownloadTask[]
}

function generateMatrix(
  urls: DownloadURL[],
  maxParallel: number
): DownloadMatrix {
  maxParallel = Math.min(maxParallel, MAX_JOBS)
  const chunkSize = Math.min(Math.ceil(urls.length / maxParallel), urls.length)
  return {
    task: _.chunk(_.shuffle(urls), chunkSize).map((chunk, index) => ({
      urls: chunk.join('\n'),
      id: `${index + 1}`,
      size: chunk.length
    }))
  }
}

async function list(): Promise<void> {
  const repoDir: string = core.getInput('repo-dir')
  const repoRef: string = core.getInput('repo-ref')
  const maxParallel: string = core.getInput('max-parallel')
  const maxParallelInt: number = parseInt(maxParallel, 10)
  if (isNaN(maxParallelInt)) {
    throw new Error('Invalid max-parallel')
  }
  const remotes = await git.listRemotes({ fs, dir: repoDir })
  if (remotes.length === 0) {
    throw new Error('No remote found')
  }
  const remote_url: string = (remotes[0].url as string).replace(
    /https:\/\/.+?@huggingface/,
    'https://huggingface'
  )
  const commits = await git.log({ fs, dir: repoDir, depth: 5, ref: repoRef })
  const headRef = commits[0].oid
  const files = await git.listFiles({ fs, dir: repoDir, ref: repoRef })
  const tasks: DownloadURL[] = []
  for (const f of files) {
    const content: string = fs.readFileSync(path.join(repoDir, f), 'utf-8')
    if (content.includes('version https://git-lfs.github.com/spec/')) {
      core.setOutput('lfs', f)
      const src_url = `${remote_url}/resolve/${headRef}/${f}`
      core.setOutput('lfs_url', src_url)
      tasks.push(src_url)
    } else {
      core.setOutput('file', f)
    }
  }
  const matrix = generateMatrix(tasks, maxParallelInt)
  core.info(`[matrix] ${JSON.stringify(matrix, null, 2)}`)
  core.setOutput('matrix', matrix)
}

async function sync(): Promise<void> {
  const urls = core.getMultilineInput('urls')
  const hfToken = core.getInput('hf-token')
  if (hfToken) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${hfToken}`
  }
  for await (const url of urls) {
    const extracted = extractURL(url)
    const dst_oss_path = path.join(
      extracted.repo,
      extracted.ref,
      extracted.file
    )
    core.info(`[download] ${url}`)
    let lastPercentCompleted = -1 // Initialize outside the download progress function
    const res = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      onDownloadProgress: progressEvent => {
        if (progressEvent.total) {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          )
          // Only print if the percentage has changed
          if (
            (Math.abs(percentCompleted - lastPercentCompleted) > 5 ||
              percentCompleted === 100) &&
            percentCompleted !== lastPercentCompleted
          ) {
            core.info(`[progress] ${percentCompleted}%`)
            lastPercentCompleted = percentCompleted // Update the last printed percentage
          }
        }
      }
    })
    await client.putStream(dst_oss_path, res.data.pipe(new PassThrough()), {
      timeout: 1000 * 60 * 60
    } as OSS.PutStreamOptions)
  }
}

type action = 'list' | 'sync'
export async function run(): Promise<void> {
  try {
    switch (core.getInput('action') as action) {
      case 'list':
        await list()
        break

      case 'sync':
        await sync()
        break

      default:
        break
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
