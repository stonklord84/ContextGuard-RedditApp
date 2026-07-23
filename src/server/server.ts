import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, reddit} from '@devvit/web/server'
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

  const pinned = await reddit.submitComment({
    id: postId,
    text: JSON.stringify({fallBackURL}),
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
