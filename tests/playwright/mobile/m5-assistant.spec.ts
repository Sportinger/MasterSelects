import { PHONE_ASSISTANT_TASKS } from '../../../src/components/mobileSkin/assistant/phoneAssistantTasks'
import { PHONE_PANELS_TEST_IDS as PANELS } from '../../../src/components/mobileSkin/panels/phonePanelsTestIds'
import { expect, IDS, tapClip, tapOn, test, type M1Session } from './m1Fixture'
import { importClipA } from './m2DesignFixture'
import { entry, openAllTools } from './m3PanelsFixture'
import {
  accessLine, AS, assistantRoot, chooseModel, endAssistantCase, installAssistantNet, openAssistant, sendRequest, signIn, signOut, startAssistantCase,
} from './m5AssistantFixture'

/**
 * M5 "Assistent" (PLAN.md section 5): the phone chat is the desktop chat runtime in a phone layout.
 * No provider runs here: the account API and the Codex Direct socket (the path all three model choices
 * use) are answered by routes that speak the protocol the client really handles, and the tool calls
 * of a canned turn are executed in the browser by the REAL editor tools, so the timeline really
 * changes. One catalog case per test, real touch, store state through the bridge. The live provider
 * run (AGENTS.md section 5) is the orchestrator's separate check.
 */
test.describe.configure({ timeout: 180_000 })

test.beforeAll(async ({ world }) => {
  // The socket mock is an init script: load a new document once; the fixture reopens the project.
  if (await installAssistantNet(world.page)) {
    await world.page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  }
})

test.afterEach(async ({ m1 }, testInfo) => {
  const frames = endAssistantCase(m1.page)
  if (testInfo.status !== testInfo.expectedStatus && frames.length > 0) {
    await testInfo.attach('codex-socket-frames.txt', { body: frames.join('\n'), contentType: 'text/plain' })
  }
})

const messages = (m1: M1Session) => m1.page.getByTestId(AS.message)
const toolRow = (m1: M1Session, tool: string) => m1.page.locator(`[data-testid="${AS.toolCall}"][data-tool="${tool}"]`)
const send = (m1: M1Session) => m1.page.getByTestId(AS.send)

async function closeAssistant(m1: M1Session): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet).toBeHidden()
}

/** Expands the tool-call list of the newest answer. */
async function expandToolCalls(m1: M1Session): Promise<void> {
  const list = m1.page.getByTestId(AS.toolCalls).last()
  if (await list.getAttribute('open') === null) await tapOn(m1, list.locator('summary'))
  await expect(list).toHaveAttribute('open', '')
}

test('assistant-chat: the top bar opens the assistant over the timeline, the preview stays, Close closes @phone', async ({ m1 }) => {
  startAssistantCase(m1.page)
  await openAssistant(m1)
  await expect(m1.page.getByTestId(IDS.previewRegion), 'the preview must stay visible above the sheet').toBeVisible()
  await expect(m1.page.getByTestId(AS.prompt)).toBeVisible()
  await expect(m1.page.locator(`[data-testid="${AS.model}"]`), 'Fast, Medium and Slow are offered').toHaveCount(3)
  await expect(accessLine(m1)).toHaveAttribute('data-access-kind', /signedOut|ready|guest|noCredits|checking/)
  await closeAssistant(m1)
})

test('guest-hosted-access: signed out greys Send with the reason and Sign in opens the account dialog; signing in clears it @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await signOut(m1)
  await expect(accessLine(m1)).toContainText(/Signed out/)
  await m1.page.getByTestId(AS.prompt).fill('Split the selected clip into 4 equal parts.')
  await expect(send(m1), 'Send stays visible but greyed while signed out').toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, send(m1))
  await expect(m1.page.getByTestId(AS.error), 'a greyed Send says why').toContainText(/Sign in/)
  expect(net.connections, 'nothing went to the assistant while signed out').toBe(0)
  await signIn(m1, net)
  await expect(accessLine(m1)).toContainText('25 credits')
  await expect(send(m1)).toHaveAttribute('aria-disabled', 'false')
  await expect(m1.page.getByTestId(AS.prompt), 'the draft survives signing in').toHaveValue('Split the selected clip into 4 equal parts.')
  await m1.page.getByTestId(AS.prompt).fill('')
  await closeAssistant(m1)
})

test('assistant entries: All tools lists every assistant task; a tap opens the assistant with it typed in, not sent @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await openAllTools(m1)
  const group = m1.page.locator(`[data-testid="${PANELS.allToolsGroup}"][data-group="Assistant"]`)
  await expect(group).toBeVisible()
  const ids = await group.getByTestId(PANELS.allToolsEntry).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-entry-id')))
  expect(ids.toSorted()).toEqual(PHONE_ASSISTANT_TASKS.map(task => `assistant:${task.catalogId}`).toSorted())
  const task = PHONE_ASSISTANT_TASKS.find(candidate => candidate.catalogId === 'INV-8/assistant-masks')!
  await m1.page.getByTestId(PANELS.allToolsSearch).fill('assistant mask')
  const row = entry(m1, `assistant:${task.catalogId}`)
  await expect(row).toHaveAttribute('aria-disabled', 'false')
  await expect(row).toContainText(`Ask the assistant: ${task.task}`)
  const before = await messages(m1).count().catch(() => 0)
  await tapOn(m1, row)
  await expect(assistantRoot(m1), 'the entry opens the assistant').toBeVisible()
  await expect(m1.page.getByTestId(AS.prompt), 'the task is typed into the field').toHaveValue(task.prompt)
  await expect(messages(m1), 'nothing was sent').toHaveCount(before)
  expect(net.connections, 'no request went out').toBe(0)
  await m1.page.getByTestId(AS.prompt).fill('')
  await closeAssistant(m1)
})

test('assistant-model-selection: the chosen model stays chosen after closing and reopening @phone', async ({ m1 }) => {
  startAssistantCase(m1.page)
  await openAssistant(m1)
  await chooseModel(m1, 'direct-medium')
  expect(await m1.page.evaluate(() => window.localStorage.getItem('ms.flashboard.chatAgentMode'))).toBe('direct-medium')
  await closeAssistant(m1)
  await openAssistant(m1)
  await expect(m1.page.locator(`[data-testid="${AS.model}"][data-mode="direct-medium"]`)).toHaveAttribute('aria-pressed', 'true')
  await expect(m1.page.locator(`[data-testid="${AS.model}"][aria-pressed="true"]`)).toHaveCount(1)
  await chooseModel(m1, 'standard')
  expect(await m1.page.evaluate(() => window.localStorage.getItem('ms.flashboard.chatAgentMode'))).toBe('standard')
  await closeAssistant(m1)
})

test('assistant-progress-and-audit: a request lists its tool calls with status and short result, and the timeline really changed @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  const clip = await importClipA(m1)
  await signIn(m1, net)
  await chooseModel(m1, 'standard')
  net.turns.push({
    intro: 'Looking at the timeline. ',
    calls: [
      { tool: 'getTimelineState', arguments: {} },
      { tool: 'splitClip', arguments: { clipId: clip.id, splitTime: 2 } },
      { tool: 'splitClip', arguments: { clipId: 'no-such-clip', splitTime: 1 } },
    ],
    answer: 'Split the clip at 2 s.',
  })
  await sendRequest(m1, 'Split the clip in the middle.')
  await expect(send(m1), 'the request finished').toHaveAttribute('data-state', 'send', { timeout: 60_000 })
  expect(net.prompts.at(-1)).toContain('Split the clip in the middle.')
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'the split did not land on the timeline' }).toBe(2)
  await expandToolCalls(m1)
  await expect(m1.page.getByTestId(AS.toolCalls).last()).toContainText('3 tool calls · 1 change · 1 failed')
  await expect(toolRow(m1, 'getTimelineState')).toHaveAttribute('data-status', 'done')
  const rows = m1.page.getByTestId(AS.toolCall)
  await expect(rows.nth(1)).toHaveAttribute('data-tool', 'splitClip')
  await expect(rows.nth(1)).toHaveAttribute('data-status', 'done')
  await expect(rows.nth(2)).toHaveAttribute('data-status', 'failed')
  await expect(rows.nth(2).locator('.phone-assistant__call-summary'), 'a failed call shows its error').not.toHaveText('')
  expect(net.toolResults.map(result => [result.tool, result.success])).toEqual([['getTimelineState', true], ['splitClip', true], ['splitClip', false]])
  await closeAssistant(m1)
})

test('assistant-request-undo: Undo after a request takes its change back; the hint says what Undo covers @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  const clip = await importClipA(m1)
  await signIn(m1, net)
  net.turns.push({ calls: [{ tool: 'splitClip', arguments: { clipId: clip.id, splitTime: 1.5 } }], answer: 'Done: split at 1.5 s.' })
  await sendRequest(m1, 'Split the clip at 1.5 seconds.')
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'the split did not land' }).toBe(2)
  const undo = m1.page.getByTestId(AS.undo)
  await expect(undo, 'a request that changed the project offers Undo').toBeVisible({ timeout: 30_000 })
  await expect(undo).toHaveAttribute('data-steps', '1')
  await expect(m1.page.getByTestId(AS.undoHint)).toContainText('Undo takes this change back.')
  await tapOn(m1, undo)
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'Undo did not take the split back' }).toBe(1)
  await expect(undo, 'nothing left to undo for this request').toHaveCount(0)
  await closeAssistant(m1)
})

/** Track count in the timeline store (the request below adds one). */
async function trackCount(m1: M1Session): Promise<number> {
  return m1.page.evaluate(async () => {
    const storeModule = '/src/stores/timeline/index.ts'
    const mod = await import(/* @vite-ignore */ storeModule) as { useTimelineStore: { getState: () => { tracks: unknown[] } } }
    return mod.useTimelineStore.getState().tracks.length
  })
}

test('assistant-request-undo-whole: one Undo takes back every change of a request with several tool calls @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  const clip = await importClipA(m1)
  await signIn(m1, net)
  const tracksBefore = await trackCount(m1)
  net.turns.push({ calls: [
    { tool: 'splitClip', arguments: { clipId: clip.id, splitTime: 1.5 } },
    { tool: 'createTrack', arguments: { type: 'video' } },
  ], answer: 'Done: split at 1.5 s and added a track.' })
  await sendRequest(m1, 'Split the clip at 1.5 seconds and add a video track.')
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'the split did not land' }).toBe(2)
  await expect.poll(() => trackCount(m1), { message: 'the track was not added' }).toBe(tracksBefore + 1)
  const undo = m1.page.getByTestId(AS.undo)
  await expect(undo, 'a request that changed the project offers Undo').toBeVisible({ timeout: 30_000 })
  await expect(undo).toHaveAttribute('data-steps', '1')
  await expect(m1.page.getByTestId(AS.undoHint)).toContainText('one tap takes all 2 changes back')
  await tapOn(m1, undo)
  await expect.poll(async () => (await m1.timeline()).main.length, { message: 'one Undo did not take the split back' }).toBe(1)
  await expect.poll(() => trackCount(m1), { message: 'the same Undo did not take the new track back' }).toBe(tracksBefore)
  await expect(undo, 'nothing left to undo for this request').toHaveCount(0)
  await closeAssistant(m1)
})

/** Text clips with their text, from the timeline store. */
async function titleTexts(m1: M1Session): Promise<string[]> {
  return m1.page.evaluate(async () => {
    const storeModule = '/src/stores/timeline/index.ts'
    const mod = await import(/* @vite-ignore */ storeModule) as { useTimelineStore: { getState: () => { clips: Array<{ source?: { type?: string }; textProperties?: { text?: string } }> } } }
    return mod.useTimelineStore.getState().clips.filter(clip => clip.source?.type === 'text').map(clip => clip.textProperties?.text ?? '')
  })
}

test('assistant-request-undo-title: a title the Direct model writes (scene stream plus tool calls) is one Undo, and Redo brings it back whole @phone', async ({ m1 }) => {
  // Production 3.3.5: this request left about six Undo steps (the text clip lands after an await,
  // the scene document is written in four more steps); the request's Undo seemed to do nothing.
  const net = startAssistantCase(m1.page)
  await importClipA(m1)
  await signIn(m1, net)
  expect(await titleTexts(m1)).toEqual([])
  const scene = [
    '{"op":"begin","schemaVersion":1,"scene":"Hallo Titel"}',
    '{"op":"tool","seq":1,"ref":"title","tool":"createTextClip","args":{"text":"Hallo Berlin","startTime":0,"duration":5}}',
    '{"op":"end","lastSeq":1}',
  ]
  net.turns.push({
    calls: [
      { tool: 'getTimelineState', arguments: {} },
      { tool: 'getStreamProtocol', arguments: { format: 'ms-scene-v1' } },
      { tool: 'getTimelineState', arguments: {} },
    ],
    answer: `Adding the title.\n\`\`\`ms-scene-v1\n${scene.join('\n')}\n\`\`\`\nDone: "Hallo Berlin" at 0 s.`,
  })
  await sendRequest(m1, 'Add a title that says "Hallo Berlin" at the start of the timeline.')
  await expect(send(m1), 'the request finished').toHaveAttribute('data-state', 'send', { timeout: 60_000 })
  await expect.poll(() => titleTexts(m1), { message: 'the title did not land' }).toEqual(['Hallo Berlin'])
  const undo = m1.page.getByTestId(AS.undo)
  await expect(undo, 'a request that changed the project offers Undo').toBeVisible({ timeout: 30_000 })
  await tapOn(m1, undo)
  await expect.poll(() => titleTexts(m1), { message: 'one Undo did not take the whole title back' }).toEqual([])
  await closeAssistant(m1)
  const redo = m1.page.getByTestId(IDS.redo)
  await expect(redo, 'Redo is offered after the request Undo').not.toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, redo)
  await expect.poll(() => titleTexts(m1), { message: 'one Redo did not bring the whole title back' }).toEqual(['Hallo Berlin'])
  await expect(redo, 'nothing of the request is left to redo').toHaveAttribute('aria-disabled', 'true')
})

test('assistant-stop: a running request shows a live progress line, and Stop ends it @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await signIn(m1, net)
  net.turns.push({ intro: 'Looking at every cut…' })
  await sendRequest(m1, 'Review every cut.')
  await expect(send(m1), 'Send turns into Stop while the request runs').toHaveAttribute('data-state', 'stop', { timeout: 30_000 })
  await expect(m1.page.getByTestId(AS.progress)).toContainText(/Writing the answer|Thinking|Looking/)
  await tapOn(m1, send(m1))
  await expect(send(m1)).toHaveAttribute('data-state', 'send', { timeout: 30_000 })
  await expect(m1.page.getByTestId(AS.progress)).toHaveCount(0)
  await expect(messages(m1).last()).toHaveAttribute('data-error', 'true')
  await expect(messages(m1).last()).toContainText(/stopped|cancelled/i)
  await closeAssistant(m1)
})

test('assistant-chat-never-blocks: closing during a request keeps it running while the timeline stays usable @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  const clip = await importClipA(m1)
  await signIn(m1, net)
  net.turns.push({ intro: 'Working on it…' })
  await sendRequest(m1, 'Make the video better.')
  await expect(send(m1)).toHaveAttribute('data-state', 'stop', { timeout: 30_000 })
  await closeAssistant(m1)
  await expect(m1.page.getByTestId(IDS.toast)).toContainText(/keeps working/)
  await tapClip(m1, clip.id)
  await expect.poll(async () => (await m1.timeline()).selectedIds, { message: 'the timeline took the tap while the request ran' }).toEqual([clip.id])
  await openAssistant(m1)
  await expect(m1.page.getByTestId(AS.progress), 'reopening shows the request still running').toBeVisible()
  expect(net.interrupts).toBe(0)
  await tapOn(m1, send(m1))
  await expect(send(m1)).toHaveAttribute('data-state', 'send', { timeout: 30_000 })
  await closeAssistant(m1)
})

test('assistant-history: the conversation keeps every turn with Copy, and New starts an empty one @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await m1.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(m1.baseURL).origin })
  await signIn(m1, net)
  await tapOn(m1, m1.page.getByTestId(AS.newChat))
  await expect(messages(m1)).toHaveCount(0)
  net.turns.push({ answer: 'First answer.' }, { answer: 'Second answer.' })
  await sendRequest(m1, 'First question?')
  await expect(messages(m1)).toHaveCount(2, { timeout: 30_000 })
  await expect(send(m1)).toHaveAttribute('data-state', 'send', { timeout: 30_000 })
  await sendRequest(m1, 'Second question?')
  await expect(messages(m1)).toHaveCount(4, { timeout: 30_000 })
  await expect(messages(m1).nth(3)).toContainText('Second answer.', { timeout: 30_000 })
  await expect(messages(m1).nth(0)).toContainText('First question?')
  await tapOn(m1, messages(m1).nth(3).getByTestId(AS.copy))
  await expect(messages(m1).nth(3).getByTestId(AS.copy)).toHaveText('Copied')
  expect(await m1.page.evaluate(() => navigator.clipboard.readText())).toContain('Second answer.')
  await tapOn(m1, m1.page.getByTestId(AS.newChat))
  await expect(messages(m1), 'New starts an empty conversation').toHaveCount(0)
  await closeAssistant(m1)
})

test('assistant-service-unreachable: a refused assistant connection shows a clear state, and Try again sends the request once it is back @phone', async ({ m1 }) => {
  const net = startAssistantCase(m1.page)
  await signIn(m1, net)
  await tapOn(m1, m1.page.getByTestId(AS.newChat))
  await expect(messages(m1)).toHaveCount(0)
  net.refuseSocket = true
  await sendRequest(m1, 'Cut the intro.')
  const state = m1.page.getByTestId(AS.serviceState)
  await expect(state, 'an unreachable service must be a clear state, not only a failed bubble').toBeVisible({ timeout: 30_000 })
  await expect(state).toHaveAttribute('data-state', 'unreachable')
  // This journey runs a development build; production builds say the service cannot be reached.
  await expect(state).toContainText(/Codex Direct is unavailable|assistant service cannot be reached/)
  await expect(send(m1), 'the failed request must not stay running').toHaveAttribute('data-state', 'send')
  expect(net.prompts, 'nothing reached the assistant').toEqual([])

  net.refuseSocket = false
  net.turns.push({ answer: 'The intro is cut.' })
  await tapOn(m1, m1.page.getByTestId(AS.serviceRetry))
  await expect(messages(m1).last()).toContainText('The intro is cut.', { timeout: 30_000 })
  await expect(state, 'the state clears once the request worked').toHaveCount(0)
  expect(net.prompts.at(-1)).toContain('Cut the intro.')
  await closeAssistant(m1)
})
