import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, reddit} from '@devvit/web/server'
import { settings } from "@devvit/web/server";
import {T3} from '@devvit/shared-types/tid.js'

import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetCounterRsp,
  type IncCounterReq,
  type IncCounterRsp,
} from '../shared/api.ts'
import {dbGetCounter, dbIncCounter} from './db.ts'
import { resolve } from 'node:path'
import { count } from 'node:console'
import type { stringify } from 'node:querystring'

type AnyRsp =
  | GetCounterRsp
  | IncCounterRsp
  | UiResponse
  | TriggerResponse
  | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1) as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetCounter:
        rsp = await routeGetCounter()
        break
      case Endpoint.IncCounter:
        rsp = await routeInc(reqMsg)
        break
      case Endpoint.OnMenuNewPost:
        rsp = await routeMenuNewPost()
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      case Endpoint.OnPostSubmit:
        rsp = await onPostSubmit(reqMsg)
        break
      default:
        endpoint satisfies never
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routeGetCounter(): Promise<GetCounterRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  return {count: await dbGetCounter(t3)}
}

async function routeInc(reqMsg: IncomingMessage): Promise<IncCounterRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  const req = await readJson<IncCounterReq>(reqMsg)
  return {count: await dbIncCounter(t3, req.amount)}
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const post = await reddit.submitCustomPost({title: context.appSlug})
  return {
    showToast: {text: `Post ${post.id} created.`, appearance: 'success'},
    navigateTo: post.url,
  }
}

async function routeAppInstall(): Promise<TriggerResponse> {
  await reddit.submitCustomPost({title: context.appSlug})
  return {}
}

async function delayTime(ms: number){
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function onPostSubmit(reqMsg: IncomingMessage): Promise<TriggerResponse> {
	console.log('new post submitted!!!!')
	const req = await readJson(reqMsg)
	let postId = (req as any).post?.id
  console.log(postId, 'this is new post id')
  // const postId = 't3_1v1413l'
	// console.log(postId, 'this is the post id!')
  /*
  fetch post metadata
  if securemedia is missing:
  - wait 3 seconds, log the count down
  - fetch post metadata again
  - check if securemedia is still missing or if its there
  */
  let totalTime = 18
  let countDown = 3
  let postMetaInfo = await reddit.getPostById(postId)
  while (!postMetaInfo.secureMedia && totalTime > 0){
    console.log(`secureMedia not loaded, waiting ${countDown} seconds...`)
    await delayTime(1000)
    countDown -= 1
    totalTime -= 1
    if (countDown == 0){
      countDown = 3
      postMetaInfo = await reddit.getPostById(postId)
      console.log(`SecureMedia still not loaded, resetting timer to 3 seconds...`)
    }
  }
  console.log(postMetaInfo.secureMedia, 'this is the secure media info, hopefully not undefined....')
  const fallBackURL = postMetaInfo.secureMedia?.redditVideo?.fallbackUrl
  const dashUrl = postMetaInfo.secureMedia?.redditVideo?.dashUrl
  console.log(fallBackURL, 'this is the fallback url')

  // Reddit stores video and audio as separate files under the same v.redd.it
  // base path. The DASH manifest (dashUrl) lists the real audio filename, so
  // we parse it instead of guessing (the naming has changed across Reddit's
  // encoding versions, e.g. CMAF_AUDIO_64.mp4 vs CMAF_AUDIO_128.mp4).
  function getBaseDir(url: string): string {
    const noQuery = url.split('?')[0] ?? url
    return noQuery.substring(0, noQuery.lastIndexOf('/') + 1)
  }

  async function getAudioUrl(dashManifestUrl: string): Promise<string | undefined> {
    const mpdRes = await fetch(dashManifestUrl)
    const mpdText = await mpdRes.text()
    const audioSetMatch = mpdText.match(/<AdaptationSet[^>]*contentType="audio"[^>]*>([\s\S]*?)<\/AdaptationSet>/)
    if (!audioSetMatch || !audioSetMatch[1]) return undefined
    const baseUrlMatches = [...audioSetMatch[1].matchAll(/<BaseURL>(.*?)<\/BaseURL>/g)]
    if (!baseUrlMatches.length) return undefined
    // last representation listed is the highest-bandwidth one (best quality)
    const audioFileName = baseUrlMatches[baseUrlMatches.length - 1]?.[1]
    if (!audioFileName) return undefined
    return getBaseDir(dashManifestUrl) + audioFileName
  }

  async function fetchAsBase64(url: string): Promise<string> {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    return Buffer.from(buf).toString('base64')
  }

  function buildGeminibody(prompt: string, videoBase64: string, audioBase64?: string){
    const parts: any[] = [
      { text: prompt },
      { inlineData: { mimeType: 'video/mp4', data: videoBase64 } },
    ]
    if (audioBase64) {
      parts.push({ inlineData: { mimeType: 'audio/mp4', data: audioBase64 } })
    }
    return JSON.stringify({
      contents: [{ parts }]
    })
  }

  if (!fallBackURL || !dashUrl) throw new Error('missing video urls')

  const audioUrl = await getAudioUrl(dashUrl)
  console.log(audioUrl, 'this is the extracted audio url')

  const videoBase64 = await fetchAsBase64(fallBackURL)
  const audioBase64 = audioUrl ? await fetchAsBase64(audioUrl) : undefined

  const apiKey = await settings.get("apiKey")
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: buildGeminibody(
      'The first file is a silent video clip. The second file (if present) is its separate audio track. Treat them as the same clip playing together, and use it for research, following this process: First, grab the tiktok handle from the video. Then, search the web to get background information on that tiktok account. Do all that in the first paragraph. Then,Search the web to find the real-world context behind what is  shown in this video — who is involved, what event or claim it relates to, and any important background a viewer should know regarding the specific contents of this video. If this is just entertainment/lifestyle content with nothing specific to verify, say so plainly instead of guessing. Put that in the second paragraph.',
      videoBase64,
      audioBase64,
    )
  })

  const res = await response.json() as any
  let geminiResponse = 'Default response'
  if (res.candidates?.length){
    geminiResponse = res.candidates?.[0].content?.parts?.[0]?.text
  }
  else{
    console.log('genai is having a stroke')
  }

  const pinned = await reddit.submitComment({
    id: postId,
    text: geminiResponse,
    runAs: 'APP',
  })

	// const pinned = await reddit.submitComment({
	// 	id: postId,
	// 	//text: JSON.stringify(postMetaInfo, null, 2),
  //   text: JSON.stringify({fallBackURL}),
	// 	runAs: "APP",
	// });
	await pinned.distinguish(true); // sticky mod comment (maps to PRAW distinguish(True))
	return {'test': 'test'}
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
