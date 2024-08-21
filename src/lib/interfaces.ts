export interface IItem {
	idx: number;
}

export interface BitInfo {
	page: number;
	/**
	 * Undefined means invalid/error Info.
	 */
	pageData: Uint8Array | undefined;
	elementIdx: number;
	bit: number;
	elementValue: number;
	state: 0 | 1;
}
