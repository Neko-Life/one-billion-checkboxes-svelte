import { SIZE_PER_PAGE } from './constants';

export function getElementValue(pageData: Uint8Array | undefined, idx: number) {
	if (!pageData) return;

	const elementIdx = Math.floor((idx % SIZE_PER_PAGE) / 8);
	return pageData.at(elementIdx);
}

export function getBitState(elementValue: number, bit: number) {
	if (typeof elementValue === 'undefined' || bit === 0) return 0;

	return elementValue & bit ? 1 : 0;
}

export function setPageElement(pageData: Uint8Array | undefined, v: number, idx: number) {
	if (!pageData) return false;

	pageData.set([v], idx);
	return true;
}
