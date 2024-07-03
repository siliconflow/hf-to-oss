/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as main from '../src/main'

// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Mock the GitHub Actions core library
let errorMock: jest.SpiedFunction<typeof core.error>
let getInputMock: jest.SpiedFunction<typeof core.getInput>
let setOutputMock: jest.SpiedFunction<typeof core.setOutput>

describe('action', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    errorMock = jest.spyOn(core, 'error').mockImplementation()
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
  })

  it('sets the file output', async () => {
    // Set the action's inputs as return values from core.getInput()
    getInputMock.mockImplementation(name => {
      switch (name) {
        case 'repo-dir':
          return getRepoDir()
        case 'repo-ref':
          return 'main'
        case 'action':
          return 'list'
        case 'max-parallel':
          return '2'
        default:
          return ''
      }
    })

    await main.run()
    expect(runMock).toHaveReturned()
    expect(setOutputMock).toHaveBeenNthCalledWith(1, 'file', '.gitattributes')
    expect(setOutputMock).toHaveBeenNthCalledWith(3, 'lfs', 'sd3demo.jpg')
    expect(setOutputMock).toHaveBeenNthCalledWith(
      4,
      'lfs_url',
      expect.stringMatching(
        /https:\/\/huggingface.co\/J5Tsai\/debug-static-files\/resolve\/.+\/sd3demo.jpg/
      )
    )
    expect(errorMock).not.toHaveBeenCalled()
  })
})
function getRepoDir(): string {
  const fromEnv = process.env.HF_TO_OSS_DEBUG_REPO_DIR
  if (fromEnv) return fromEnv
  throw new Error('Function not implemented.')
}
