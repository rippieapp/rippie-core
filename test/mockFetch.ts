import type { FetchLike } from '../src/types.js'

export type RecordedRequest = {
	url: string
	method: string
	headers: Record<string, string>
	body: string | null
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>

export type MockFetch = {
	fetch: FetchLike
	requests: RecordedRequest[]
	/** Requests whose URL contains the given fragment. */
	matching: (fragment: string) => RecordedRequest[]
}

const toHeaders = (init?: RequestInit): Record<string, string> => {
	const headers: Record<string, string> = {}
	for (const [key, value] of Object.entries((init?.headers as Record<string, string>) ?? {})) {
		headers[key.toLowerCase()] = value
	}
	return headers
}

/**
 * Builds a fetch stub that records every request and answers from a routing table.
 *
 * Keys are matched as substrings of the request URL, in insertion order. An unmatched request
 * resolves to a 404 so a provider's error path is exercised rather than throwing.
 */
export const mockFetch = (routes: Record<string, Handler | unknown>): MockFetch => {
	const requests: RecordedRequest[] = []
	const entries = Object.entries(routes)

	const fetchImpl: FetchLike = async (input, init) => {
		const url = typeof input === 'string' ? input : input.toString()
		const request: RecordedRequest = {
			url,
			method: init?.method ?? 'GET',
			headers: toHeaders(init),
			body: typeof init?.body === 'string' ? init.body : null,
		}
		requests.push(request)

		const match = entries.find(([fragment]) => url.includes(fragment))
		if (!match) return new Response('not found', { status: 404 })

		const [, handler] = match
		if (typeof handler === 'function') return (handler as Handler)(request)
		return Response.json(handler)
	}

	return {
		fetch: fetchImpl,
		requests,
		matching: (fragment) => requests.filter((request) => request.url.includes(fragment)),
	}
}

/**
 * Builds an OK response reporting `finalUrl` as its own URL.
 *
 * `fetch` sets `Response.url` to the last hop after following redirects, but a constructed
 * Response always reports an empty string, so it is overridden here.
 */
export const respondFrom = (finalUrl: string, body = ''): Response => {
	const response = new Response(body, { status: 200 })
	Object.defineProperty(response, 'url', { value: finalUrl })
	return response
}

/** A fetch stub that always rejects, for testing that providers swallow network failures. */
export const failingFetch: FetchLike = async () => {
	throw new Error('network down')
}
