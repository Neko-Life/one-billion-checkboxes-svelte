import {
	SIZE_PER_PAGE
	//USE_MAX_BIT_COUNT
} from './constants';

export function getElementValue(pageData: DataView | undefined, idx: number) {
	if (!pageData) return;

	//const elementIdx = Math.floor((idx % SIZE_PER_PAGE) / USE_MAX_BIT_COUNT);
	//return pageData.getUint8(elementIdx);
	const elementIdx = Math.floor(idx % SIZE_PER_PAGE);
	return pageData.getUint32(elementIdx * 4);
}

export function getBitState(elementValue: number, bit: number): 0 | 1 {
	if (typeof elementValue === 'undefined' || bit === 0) return 0;

	return elementValue & bit ? 1 : 0;
}

export function setPageElement(pageData: DataView | undefined, v: number, idx: number) {
	if (!pageData) return false;

	//pageData.setUint8(idx, v);
	pageData.setUint32(idx * 4, v);
	return true;
}
