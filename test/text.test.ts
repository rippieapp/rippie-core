import { describe, expect, test } from 'bun:test'
import { normalizeText, trackSignature } from '../src/text.js'

describe('normalizeText', () => {
	test('returns an empty string for empty input', () => {
		expect(normalizeText('')).toBe('')
	})

	test('lowercases and collapses whitespace', () => {
		expect(normalizeText('  Never   GONNA  Give   ')).toBe('never gonna give')
	})

	test('treats slug separators as spaces', () => {
		expect(normalizeText('never-gonna_give-you-up')).toBe('never gonna give you up')
	})

	test('strips punctuation', () => {
		expect(normalizeText('Hello, World! (Live) [2024] ™')).toBe('hello world live 2024')
	})

	test('truncates everything from a feature credit onwards', () => {
		expect(normalizeText('Song Name feat. Someone Else')).toBe('song name')
		expect(normalizeText('Song Name ft Someone Else')).toBe('song name')
		expect(normalizeText('Song Name featuring Someone Else')).toBe('song name')
	})

	test('removes standalone noise words but not substrings of real words', () => {
		expect(normalizeText('Song Name - Remastered 2011')).toBe('song name 2011')
		expect(normalizeText('Official Audio Version')).toBe('')
		// "single" is noise, but "singles" is not a standalone match
		expect(normalizeText('Singles Collection')).toBe('singles collection')
	})

	test('makes differently formatted signatures for the same track converge', () => {
		const a = normalizeText('Rick Astley - Never Gonna Give You Up (Official Video)')
		const b = normalizeText('rick_astley - never gonna give you up [Remastered]')
		expect(a).toBe(b)
	})
})

describe('trackSignature', () => {
	test('joins artist and song with a dash', () => {
		expect(trackSignature('Artist', 'Song')).toBe('Artist - Song')
	})
})
