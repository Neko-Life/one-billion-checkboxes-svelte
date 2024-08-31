<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SERVER_DOMAIN_URL } from '$lib/config';
	import { type BitInfo, type IItem } from '$lib/interfaces';
	import {
		BASE_MIN_RENDER_ROW,
		MAX_LOAD_REQ_QUEUE_SIZE,
		MAX_CBOX_IDX,
		SIZE_PER_PAGE,
		//USE_MAX_BIT_COUNT,
		DEFAULT_CHECKBOX_ACCENT
	} from '$lib/constants';
	import { getBitState, setPageElement } from '$lib/bitUtils';
	import { ColourPicker } from 'svelte-colourpicker';

	let colorValue = DEFAULT_CHECKBOX_ACCENT;

	let modalPrompt = '';

	let maxRow = 0;

	let socket: WebSocket;

	let wsStatus = -1;

	let innerWidth: number = 0;
	let innerHeight: number = 0;

	let startNum = 0;

	// queue for page load request
	let loadReqQueue: number[] = [];
	let cboxes: Map<number, DataView> = new Map();
	let items: IItem[][] = [];

	let contentRef: HTMLDivElement;
	let listRef: HTMLElement;
	let topRef: HTMLDivElement;
	let bottomRef: HTMLDivElement;

	let testCboxRow: HTMLDivElement | undefined;
	let testCbox: HTMLDivElement;

	let widthPerRow: number = 0;
	let widthPerCBox: number = 0;

	let itemPerRow = 0;
	let hasItemPerRowSet = false;

	let userCount = 0;
	let checkedCount = 0;
	let maxStartNum = 0;

	const updateWidth = (noUpdate = false) => {
		let update = false;
		if (testCboxRow && widthPerRow != testCboxRow.clientWidth) {
			widthPerRow = testCboxRow.clientWidth;
			update = true;
		}

		if (testCbox && widthPerCBox != testCbox.clientWidth) {
			widthPerCBox = testCbox.clientWidth;
			update = true;
		}
		if (!noUpdate && update) updateItems(true);
	};

	$: if (innerWidth) updateWidth();
	$: if (innerHeight) updateItems(true);

	let saveColorValueTimeout: ReturnType<typeof setTimeout> | null = null;
	$: if (
		typeof window !== 'undefined' &&
		colorValue &&
		colorValue !== window.localStorage.getItem('color')
	) {
		if (saveColorValueTimeout) {
			clearTimeout(saveColorValueTimeout);
			saveColorValueTimeout = null;
		}

		saveColorValueTimeout = setTimeout(() => window.localStorage.setItem('color', colorValue), 670);
	}

	const getItem = (i: number) => {
		return { idx: i };
	};

	let toggleRounding = false;
	let wannaSee = -1;
	let higlightWannaSee = -1;
	const updateItemPerRow = (setWannaSee = false) => {
		if (!hasItemPerRowSet) {
			itemPerRow = Math.floor(widthPerRow / widthPerCBox);
		}

		if (testCboxRow && listRef) {
			const maxR = Math.ceil(listRef.clientHeight / testCboxRow.clientHeight);
			maxRow = maxR + BASE_MIN_RENDER_ROW;
			maxStartNum = MAX_CBOX_IDX - maxRow * itemPerRow + itemPerRow;
		}

		startNum = Math.round(startNum - (startNum % itemPerRow));
		startNum += startNum > 0 && toggleRounding ? itemPerRow : 0;
		toggleRounding = !toggleRounding;
		if (startNum < 0) startNum = 0;
		if (startNum > maxStartNum) {
			startNum = maxStartNum;
		}
		const diff = startNum % itemPerRow;
		startNum = startNum - diff;

		if (setWannaSee) {
			wannaSee = startNum;
			startNum -= Math.round((BASE_MIN_RENDER_ROW / 2) * itemPerRow);
			if (startNum < 0) startNum = 0;
			const diff = startNum % itemPerRow;
			startNum = startNum - diff;
			setTimeout(() => {
				listRef && listRef.scrollTo(0, 1);
			}, 500);
		}
	};

	const scrollToWannaSee = async () => {
		if (wannaSee === -1) return;

		const to = document.querySelector(`input[data-idx="${wannaSee}"]`);
		if (!to) return;
		to.scrollIntoView({ block: 'center' });

		setTimeout(() => {
			wannaSee = -1;
		}, 1000);
	};

	const updateItems = async (recalculateItemPerRow = false, setWannaSee = false) => {
		await tick();
		updateWidth(true);
		if (recalculateItemPerRow) {
			if (!testCboxRow || !listRef || !contentRef) return;

			updateItemPerRow(setWannaSee);

			items = [];

			const toRow = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ maxRow;
			for (let i = 0; i < toRow; i++) {
				const row: IItem[] = [];
				const start = startNum + i * itemPerRow;
				const end = start + itemPerRow;

				for (let j = start; j < end; j++) {
					if (j > MAX_CBOX_IDX) break;
					const cbox = getItem(j);
					row.push(cbox);
				}

				if (row.length) items.push(row);
				if (row[row.length - 1].idx >= MAX_CBOX_IDX) break;
			}
		} else {
			// push and pop according new startNum
			const firstRow = items[0];
			const firstItem = firstRow[0];
			if (firstItem.idx > startNum) {
				const rpt = Math.round((firstItem.idx - startNum) / itemPerRow);
				// scrolling up, unshift and pop
				let sb = false;
				for (let j = rpt; j > 0; j--) {
					items.pop();
					const row = [];
					for (let i = startNum + itemPerRow * (j - 1); i < startNum + itemPerRow * j; i++) {
						if (i < 0) {
							sb = true;
							break;
						}
						row.push(getItem(i));
					}
					if (sb) break;
					items.unshift(row);
				}
				items = items;
			} else if (firstItem.idx < startNum) {
				const rpt = Math.round((startNum - firstItem.idx) / itemPerRow);
				// scrolling down, shift and push
				let lid = 0;
				for (let j = 0; j < rpt; j++) {
					if (lid > MAX_CBOX_IDX) break;
					const lastRow = items[items.length - 1];
					const lastItem = lastRow[lastRow.length - 1];
					lid = lastItem.idx;
					if (lid > MAX_CBOX_IDX) break;
					items.shift();
					const row = [];
					for (let i = lastItem.idx + 1; i < lastItem.idx + 1 + itemPerRow; i++) {
						lid = i;
						if (lid > MAX_CBOX_IDX) break;
						row.push(getItem(i));
					}
					if (row.length) items.push(row);
				}
				items = items;
			}

			// else nothing to do
		}

		//console.log({ items, itemPerRow, startNum });
		updateCBoxInfo();
	};

	let startIdx = 0;
	let endIdx = 0;

	const getElDataIdx = (el: HTMLElement, last = false) => {
		const r = last
			? el.lastElementChild?.lastElementChild
			: el.firstElementChild?.firstElementChild;

		return r?.attributes.getNamedItem('data-idx')?.value;
	};

	const updateSeenStartEnd = async () => {
		if (!listRef) return;

		await tick();

		const listEl = document.getElementsByClassName('item-row') as HTMLCollectionOf<HTMLDivElement>;

		const containerRects = listRef.getBoundingClientRect();

		let top: HTMLDivElement | undefined;
		let bottom: HTMLDivElement | undefined;
		let topRects = top?.getBoundingClientRect();
		let bottomRects = bottom?.getBoundingClientRect();
		// find top and bottom
		for (const el of listEl) {
			const elRects = el.getBoundingClientRect();
			if (!getElDataIdx(el)) continue;

			let skip = false;

			if (!top) {
				if (elRects.bottom > containerRects.top) {
					top = el;
					topRects = elRects;
				}

				skip = true;
			}

			if (!bottom) {
				if (elRects.top < containerRects.bottom) {
					bottom = el;
					bottomRects = elRects;
				}

				skip = true;
			}

			if (skip || !topRects || !bottomRects) continue;

			//console.log({
			//	elRects,
			//	containerRects,
			//	topRects,
			//	secondYes: elRects.bottom < topRects.bottom,
			//	firstYes: elRects.bottom > containerRects.top
			//});

			if (elRects.bottom > containerRects.top && elRects.bottom < topRects.bottom) {
				topRects = elRects;
				top = el;
				//console.log({ topSetTo: el });
			}

			if (elRects.top < containerRects.bottom && elRects.top > bottomRects.top) {
				bottomRects = elRects;
				bottom = el;
			}
		}

		if (!top || !bottom) return;

		const topInp = getElDataIdx(top);
		const bottomInp = getElDataIdx(bottom, true);
		startIdx = topInp ? parseInt(topInp) : 0;
		endIdx = bottomInp ? parseInt(bottomInp) : 0;

		//console.log({
		//	top,
		//	topRects,
		//	bottom,
		//	bottomRects,
		//	topInp,
		//	bottomInp,
		//	startIdx,
		//	endIdx,
		//	containerRects
		//});

		scrollToWannaSee();
	};

	const handleScroll = updateSeenStartEnd;

	const handleScrollEnd = async (event: Event & { target: EventTarget & any }) => {
		//console.log({ testCboxRow, t: event.target, topRef, listRef, maxRow });
		if (!testCboxRow || !event.target || !topRef || !listRef || !maxRow) return;

		//console.log(event, topRef, listRef);

		updateItemPerRow();

		const vPort = event.target;
		const scrollBase: number = vPort.scrollTop;
		const scrollMax: number = vPort.scrollHeight - vPort.clientHeight;

		//console.log({ scrollMax });
		if (!scrollMax) return;

		const oneFourth = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ scrollMax / 4;
		const mod = testCboxRow.clientHeight;
		let update = false;

		const thirdFourth = oneFourth * 3;

		//console.log({ oneFourth, scrollBase, startNum, maxStartNum });

		if (scrollBase > thirdFourth && startNum < maxStartNum && endIdx < MAX_CBOX_IDX) {
			// scroll down
			const diff = scrollBase - thirdFourth;
			let entry = Math.ceil(diff / mod);

			const firstRow = items[0];
			if (!firstRow) throw Error('no way');
			const first = firstRow[0];
			if (!first) throw Error('what');
			startNum = first.idx + itemPerRow * entry;
			if (startNum > maxStartNum) {
				entry -= (startNum - maxStartNum) / itemPerRow;
				startNum = maxStartNum;
			}

			const to = scrollBase - mod * entry;
			//console.log({ to });
			vPort.scrollTo(0, to);
			update = true;
		} else if (scrollBase < oneFourth && startNum > 0) {
			// scroll up
			const diff = oneFourth - scrollBase;
			let entry = Math.ceil(diff / mod);

			const firstRow = items[0];
			if (!firstRow) throw Error('no way!');
			const first = firstRow[0];
			if (!first) throw Error('what!');
			startNum = first.idx - itemPerRow * entry;
			if (startNum < 0) {
				entry -= Math.abs(startNum) / itemPerRow;
				startNum = 0;
			}

			const to = scrollBase + mod * entry;
			//console.log({ to });
			vPort.scrollTo(0, to);
			update = true;
		}

		//console.log({ startNum, update });
		if (update) updateItems();
	};

	const handleReconnect = () => {
		if (wsStatus != -1) return;
		socketCleanUp();
		console.log('Reconnecting...');
		socketInit();
	};

	const getPageData = (idx: number) => {
		const page = Math.floor(idx / SIZE_PER_PAGE);
		return cboxes.get(page);
	};

	const getState = (idx: number): BitInfo => {
		const returnError = () =>
			Object.freeze({
				state: 0,
				page: -1,
				elementIdx: -1,
				bit: 0,
				pageData: undefined,
				elementValue: 0
			});

		if (Number.isNaN(idx)) return returnError();

		const page = Math.floor(idx / SIZE_PER_PAGE);
		const pageData = cboxes.get(page);
		if (!pageData) {
			sendLoadReq(page);
			return returnError();
		}

		//const elementIdx = Math.floor((idx % SIZE_PER_PAGE) / USE_MAX_BIT_COUNT);
		const elementIdx = Math.floor(idx % SIZE_PER_PAGE);
		let elementValue = 0;

		try {
			elementValue = pageData.getUint32(elementIdx * 4);
		} catch (e) {
			return returnError();
		}
		//console.log({ pageData });
		//console.log({ elementValue, elementIdx, idx });
		if (typeof elementValue === 'undefined') return returnError();

		//const bit = 1 << (idx % SIZE_PER_PAGE) % USE_MAX_BIT_COUNT;
		//console.log({ bit, idx });

		const ret = Object.freeze({
			//state: getBitState(elementValue, bit),
			state: getBitState(elementValue, 1),
			page,
			elementIdx,
			bit: 1,
			pageData,
			elementValue
		});

		//console.log(ret);

		return ret;
	};

	const isActive = (i: number) => {
		//console.log({ isActive: item, actives });
		const state = getState(i);

		//console.log({ item, state, page: state.page });

		return state.state === 1;
	};

	const removeActive = (item: IItem) => {
		const s = getState(item.idx);
		if (s.state) {
			if (setPageElement(s.pageData, s.elementValue & ~s.bit, s.elementIdx)) {
				checkedCount--;
				return true;
			}
		}

		return false;
	};

	const setColor = (n: number, r: number, g: number, b: number, a: number) => {
		const s = getState(n);
		setPageElement(
			s.pageData,
			((r << (8 * 3)) | (g << (8 * 2)) | (b << 8) | a) & 0xfffffffe,
			s.elementIdx
		);
	};

	const addActive = (item: IItem) => {
		const s = getState(item.idx);
		if (!s.state) {
			//console.log({ sBefore: s });
			if (setPageElement(s.pageData, s.elementValue | s.bit, s.elementIdx)) {
				checkedCount++;
				return true;
			}
		}

		return false;
	};

	const sendSwitch = (i: number, r: number, g: number, b: number, a: number) => {
		if (wsStatus !== 0) return -1;
		socket.send(
			i.toString() +
				';' +
				r.toString() +
				';' +
				g.toString() +
				';' +
				b.toString() +
				';' +
				a.toString()
		);

		return 0;
	};

	//let start = -1;
	//let end = -1;
	const sendLoadReq = (page: number) => {
		if (cboxes.get(page)) {
			return 0;
		}

		if (wsStatus === 0) {
			socket.send(`gp;${page}`);
			cboxes.set(page, new DataView(new ArrayBuffer(0)));
			return 0;
		}

		if (loadReqQueue.includes(page)) return -1;

		loadReqQueue.push(page);
		if (loadReqQueue.length <= MAX_LOAD_REQ_QUEUE_SIZE) return -1;

		const first = loadReqQueue[0];
		const b = page > first ? page : first;
		const s = first > page ? page : first;

		const last = loadReqQueue[loadReqQueue.length - 1];
		const b2 = page > last ? page : last;
		const s2 = last > page ? page : last;

		if (b - s >= b2 - s2) loadReqQueue.shift();
		else loadReqQueue.pop();

		return -1;
	};

	const getColorValues = (): [number, number, number, number] => {
		const matches = colorValue.match(/(\d+(?:\.\d+)?)/g);
		const ret = matches?.map((v) => Number(v));
		console.log({ ret, colorValue, matches });

		if (ret?.length === 4) {
			ret[3] = Math.ceil(ret[3] * 255);
			// @ts-ignore
			return ret;
		}

		// @ts-ignore
		return [];
	};

	const getItemColor = (n: number) => {
		const s = getState(n);
		const val = s.elementValue;

		if (val === 0 || s.page === -1) return DEFAULT_CHECKBOX_ACCENT;

		return `rgba(${(val >> (8 * 3)) & 0xff},${(val >> (8 * 2)) & 0xff},${(val >> 8) & 0xff},${(val & 0xff) / 0xff})`;
	};

	const switchActive = (item: IItem) => {
		//console.log({ switchActive: item });
		const { e, item: item2, row, holyMolyWackaMoly } = item as any;
		if (!e || !item2 || !row || holyMolyWackaMoly !== '!') return -1;
		const s = getState(item.idx);
		if (s.page === -1) return -1;

		const currentColor = getColorValues();
		if (sendSwitch(item.idx, ...currentColor)) return -1;
		if (removeActive(item)) return 0;

		setColor(item.idx, ...currentColor);
		addActive(item);

		return 0;
	};

	const handleCBoxClick = (
		e: MouseEvent & {
			currentTarget: EventTarget & HTMLInputElement;
		},
		item: IItem,
		row: IItem[]
	) => {
		const pe = e.preventDefault;
		const pr = pe.bind(e);

		if (
			!e?.target ||
			switchActive({
				idx: row.find((v) => v.idx === item.idx)!.idx,
				e,
				item,
				row,
				holyMolyWackaMoly: '!'
			} as any)
		)
			pr();
		else {
			e.currentTarget.style.accentColor = getItemColor(item.idx);
		}
	};

	// socket states
	let s = false;
	let k = 'ehEk';
	let o = k.length;
	let g = 0;
	let awaitingState = -1;

	const handleSocketOpen = (ev: Event) => {
		s = false;
		k = 'ehEk';
		o = k.length;
		g = 0;
		awaitingState = -1;
		cboxes.clear();
		wsStatus = 0;

		socket.send('gv;');

		for (const q of loadReqQueue) {
			sendLoadReq(q);
		}

		loadReqQueue = [];
		items = items;
		console.info("You're ready to go");
	};

	const socketPayloadErrClose = (e: any) => {
		console.error('Invalid payload received');
		console.error(e);

		socketCleanUp();
	};

	let socketMessages: MessageEvent<ArrayBuffer>[] = [];
	let handlingSocketMessage = false;

	const handleSocketMessageEvent = (ev: MessageEvent<ArrayBuffer>) => {
		//console.log({ awaitingState });
		if (awaitingState >= 0)
			try {
				const u8arr = new DataView(ev.data);

				//console.log({ awaitingState, u8arr });

				cboxes.set(awaitingState, u8arr);

				updateItems(true);
				return;
			} catch (e) {
				socketPayloadErrClose(e);
				return;
			} finally {
				awaitingState = -1;
			}

		let data: string;
		try {
			if (ev.data instanceof ArrayBuffer) {
				data = '';
				const dataView = new DataView(ev.data);
				for (let i = 0; i < dataView.byteLength; i++) {
					data += String.fromCharCode(dataView.getUint8(i));
				}
			} /*if (typeof ev.data === 'string') */ else {
				data = ev.data;
			}

			//console.log({ data });
		} catch (e) {
			socketPayloadErrClose(e);
			return;
		}

		const retInc = () => {
			if (!['uc;', 's;'].some((v) => data.startsWith(v))) {
				g++;
				if (g > o) {
					g = 0;
					k = data;
				}
			}

			//console.log({ g, k, o, data });
		};
		retInc();

		if (data.startsWith('ws;')) {
			const nStr = data.substring(3);
			const n = nStr.length ? parseInt(nStr) : NaN;
			if (Number.isNaN(n)) return;

			//console.log({ awaitingStateBeforeSet: awaitingState });
			awaitingState = n;
			//console.log({ awaitingStateAfterSet: awaitingState });
			return;
		}

		if (data === 'l;') {
			s = true;
			return;
		}

		if (data.startsWith('v;')) {
			const newV = parseInt(data.substring(2));
			checkedCount = Number.isNaN(newV) ? 0 : newV;
			return;
		}

		if (data.startsWith('uc;')) {
			const newUc = parseInt(data.substring(3));
			userCount = Number.isNaN(newUc) ? 0 : newUc;
			return;
		}

		if (s) {
			if (data.length > 2) {
				const r = parseInt(data.substring(2));

				//console.log({ r });

				if (!Number.isNaN(r) && r) {
					o = r;
				}
			}

			s = false;

			return;
		}

		if (data === 'h;') {
			//console.log({ s, k, o, g });
			socket.send(k);
			return;
		}

		if (data.startsWith('s;')) {
			const matches = data.match(/(\d+)/g);
			let n = NaN;
			let r = NaN;
			let g = NaN;
			let b = NaN;
			let a = NaN;

			if (matches?.length === 5) {
				n = parseInt(matches[0]);
				r = parseInt(matches[1]);
				g = parseInt(matches[2]);
				b = parseInt(matches[3]);
				a = parseInt(matches[4]);
			}

			if (Number.isNaN(n) || n > MAX_CBOX_IDX) {
				console.error('Invalid packet received');
				socketCleanUp();
				return;
			}

			if (a & 1) {
				setColor(n, r, g, b, a);
				addActive({ idx: n });
			} else {
				removeActive({ idx: n });
			}

			items = items;

			return;
		}
	};

	const tryHandleSocketMessage = async () => {
		if (handlingSocketMessage) return;
		handlingSocketMessage = true;

		//console.log({ socketMessagesBefore: socketMessages });
		let inc = 0;
		for (const ev of socketMessages) {
			await handleSocketMessageEvent(ev);
			inc++;
		}
		//console.log({ socketMessagesAfter: socketMessages, inc });
		socketMessages = [];

		handlingSocketMessage = false;
	};

	const handleSocketMessage = (ev: MessageEvent<ArrayBuffer>) => {
		//socketMessages.push(ev);
		//tryHandleSocketMessage();
		handleSocketMessageEvent(ev);
	};

	const handleSocketClose = (ev: CloseEvent) => {
		// !TODO: toast
		switch (wsStatus) {
			case 0:
				switch (ev.code) {
					case 69:
					case 420:
						console.warn('Disconnected, check your behavior!');
						console.error('This incident will be reported to @shasharina');
						break;

					default:
						console.warn('Disconnected, code:', ev.code);
				}
				break;
			case 1:
				console.warn('Unable to connect, try again by clicking the `Reconnect` button');
				break;
		}

		wsStatus = -1;
	};

	const socketInit = () => {
		socket = new WebSocket(`${SERVER_DOMAIN_URL}/game`);
		socket.binaryType = 'arraybuffer';

		//(window as any).sock = socket;
		wsStatus = 1;

		socket.onopen = (...args) => {
			//console.log('[OPEN]', ...args);
			handleSocketOpen(args[0]);
		};

		socket.onmessage = (...args) => {
			//console.log('[MESSAGE]', ...args);
			handleSocketMessage(args[0]);
		};
		//socket.onerror = (...args) => console.error('[ERROR]', ...args);

		socket.onclose = (...args) => {
			//console.warn('[CLOSE]', ...args);
			handleSocketClose(args[0]);
		};
	};

	const socketCleanUp = () => {
		if (socket && (!socket.CLOSED || !socket.CLOSING)) {
			socket.close();
		}
	};

	const loadSavedColor = () => {
		const c = window.localStorage.getItem('color');
		if (c) colorValue = c;
	};

	onMount(() => {
		(window as any).getState = getState;

		if (listRef) {
			const vPort = listRef; //.$$.ctx[2];
			vPort.addEventListener('scrollend', handleScrollEnd);
			vPort.addEventListener('scroll', handleScroll);
		}

		console.info("1'000'000'000 Checkboxes - Client");
		console.info('With Color only compatible build');
		console.info('https://www.github.com/Neko-Life');

		console.log('Connecting...');
		socketInit();
		loadSavedColor();

		return () => {
			if (listRef) {
				const vPort = listRef; //.$$.ctx[2];
				vPort.removeEventListener('scrollend', handleScrollEnd);
				vPort.removeEventListener('scroll', handleScroll);
			}

			socketCleanUp();
		};
	});

	let f: number = 0;
	let l: number = 0;
	$: if (startIdx || 1) f = startIdx;
	$: if (endIdx || 1) l = endIdx;

	const updateCBoxInfo = async () => {
		updateSeenStartEnd();
	};

	$: if (items || itemPerRow) updateCBoxInfo();

	const promptJumpToRow = () => {
		modalPrompt = 'Jump to Row';
	};

	const promptJumpToCheckbox = () => {
		modalPrompt = 'Jump to Checkbox';
	};

	$: fStr = Math.floor(f ? f / itemPerRow : 0) + 1;
	$: lStr = Math.floor(l ? (l - (itemPerRow - 1)) / itemPerRow : 0) + 1;
	//$: console.log({ f, l, fStr, lStr, itemPerRow });
	//$: console.log({ itemPerRow, innerHeight, maxRow, testCboxRowHeight: testCboxRow?.clientHeight });

	const handleModalClick = (
		e: (MouseEvent | KeyboardEvent) & {
			currentTarget: EventTarget & HTMLElement;
			target: EventTarget | null;
		}
	) => {
		if (!(e.target as HTMLElement)?.classList.contains('modal-content-container')) {
			return;
		}
		e.preventDefault();
		modalPrompt = '';
	};

	const handleModalGo = (
		e: SubmitEvent & {
			currentTarget: EventTarget & HTMLFormElement;
		}
	) => {
		e.preventDefault();

		const inputs = (e.target as HTMLFormElement).elements;
		const val = (inputs['goto' as any] as HTMLInputElement).value;
		const valN = parseInt(val) - 1;

		if (Number.isNaN(valN)) {
			higlightWannaSee = -1;
			return;
		}

		const gotoRow = modalPrompt.endsWith('Row');

		if (gotoRow) {
			startNum = valN * itemPerRow;
			higlightWannaSee = startNum;
		} else {
			startNum = valN;
			higlightWannaSee = valN;
		}
		const diff = startNum % itemPerRow;
		startNum = startNum - diff;

		updateItems(true, true);
		(e.target as HTMLFormElement).reset();
		modalPrompt = '';
	};
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="page-container">
	<div class="container">
		<header>
			<section class="info" aria-label="info">
				<p>Checkbox: <span>{f + 1}# - {l ? l + 1 : Infinity}#</span></p>
				<p>
					Row: <span>{fStr} - {lStr}</span>
				</p>
				<p>{itemPerRow} Column{itemPerRow === 1 ? '' : 's'}</p>

				<div title="Pick your color" class="picker">
					<!-- data-theme="dark"-->
					<ColourPicker bind:value={colorValue} />
					<button title="Reset color" on:click={() => (colorValue = DEFAULT_CHECKBOX_ACCENT)}
						>Reset</button
					>
				</div>
			</section>
			<section class="title-container" aria-label="title">
				<h1>One Billion Checkboxes</h1>
				<p><span>Created by </span><a href="https://github.com/Neko-Life">Shasharina</a></p>
				<p><span>Influence by </span><a href="https://tmcb.helba.ai/">10 Million Checkboxes</a></p>
			</section>
			<section class="status" aria-label="status">
				<div class="status-info">
					<p>{checkedCount} / 1,000,000,000 Checked</p>

					{#if userCount > 0}
						<p>{userCount} user{userCount == 1 ? '' : 's'} playing</p>
					{/if}
					{#if wsStatus === 0}
						<p>Connected</p>
					{:else if wsStatus === 1}
						<p>Connecting...</p>
					{:else if wsStatus === -1}
						<button title="Reconnect" on:click={handleReconnect}>Reconnect</button>
					{/if}
					<button title="Jump to specific row" on:click={promptJumpToRow}>Jump to row</button>
					<button title="Jump to specific checkbox" on:click={promptJumpToCheckbox}
						>Jump to checkbox</button
					>
				</div>
			</section>
		</header>

		<main bind:this={listRef} aria-label="content">
			<div class="content-container-container"></div>

			<div bind:this={testCboxRow} class="item-row zh">
				<div class="inp-container" bind:this={testCbox}>
					<input class="inp-item" type="checkbox" />
				</div>
			</div>
			<div class="zh-cov"></div>

			<div bind:this={topRef}></div>
			<!--
			{#each new Array(scrollTrigger).fill(null) as i}
				<div style="min-height: {cH}px;" class="scroll-trigger">whats wrong w u?</div>
			{/each}
					<div style="padding-top: {contentPT}px;"></div>
			<div  class="content-container">
			</div>
                        -->
			<div bind:this={contentRef} class="content">
				{#each items as item}
					{#key item[0].idx}
						<div class="item-row {item.some((v) => v.idx === higlightWannaSee) ? 'wns' : ''}">
							{#each item as i}
								{#key i.idx}
									<div class="inp-container {i.idx === higlightWannaSee ? 'wns' : ''}">
										<input
											class="inp-item"
											type="checkbox"
											data-idx={i.idx}
											checked={isActive(i.idx)}
											style="accent-color: {getItemColor(i.idx)};"
											on:click={(e) => handleCBoxClick(e, i, item)}
										/>
									</div>
								{/key}
							{/each}
						</div>
					{/key}
				{/each}
			</div>
			<div bind:this={bottomRef}></div>
		</main>
	</div>
</div>

<div class="modal-container {!!modalPrompt ? 'show' : ''}">
	<section
		class="modal modal-content-container"
		on:click={handleModalClick}
		on:keyup={(e) => (e.key === 'Escape' ? handleModalClick(e) : null)}
		aria-label="Modal Prompt"
	>
		<form class="modal-content" on:submit={handleModalGo}>
			<h1>{modalPrompt}</h1>
			<input name="goto" type="number" autofocus />
			<button title="Submit" type="submit">GO!</button>
		</form>
	</section>
</div>

<style>
	.page-container {
		min-height: 100vh;
		min-width: 100vw;
		height: 100vh;
		width: 100vw;
		display: flex;
	}

	.container {
		height: 100%;
		width: 100%;
		display: flex;
		flex-direction: column;
		overflow: auto;
		margin: 0 4.166666666666667%;
	}

	header {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		padding: 8px;
		border-bottom: 2px solid black;
	}

	* {
		font-size: 10px;
	}

	.info {
		font-size: 10px;
		font-weight: 600;
		font-style: italic;
	}

	.title-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
	}

	.title-container * {
		display: flex;
		justify-content: center;
		align-items: center;
		text-align: center;
	}

	.title-container h1 {
		font-size: 20px;
		margin: 0px;
	}

	.title-container p {
		margin: 0px;
		margin-top: 10px;
		gap: 4px;
	}

	@media (min-width: 600px) {
		* {
			font-size: 14px;
		}

		.info {
			font-size: 16px;
		}

		.modal-content h1 {
			font-size: 30px;
		}

		.modal-content input {
			font-size: 18px;
		}

		button {
			font-size: 14px;
		}

		.modal-content button {
			font-size: 24px;
		}
	}

	@media (min-width: 1280px) {
		* {
			font-size: 16px;
		}

		.title-container h1 {
			font-size: 36px;
		}
	}

	.status {
		display: flex;
	}

	.picker {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		width: fit-content;
		gap: 14px;
	}

	.status .status-info {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: flex-end;
		flex: 1;
		gap: 14px;
	}

	.status .status-info p {
		margin: 0px;
		text-align: right;
	}

	main {
		display: flex;
		flex-direction: column;
		flex-grow: 1;
		overflow-y: scroll;
		overflow-x: hidden;
		position: relative;
	}

	.content-container-container {
		position: sticky;
		top: 0;
		max-height: 0px;
	}

	.content {
		height: 100%;
	}

	.item-row {
		display: flex;
		justify-content: space-evenly;
		width: 100%;
		transition-duration: 2500ms;
		background-color: transparent;
	}

	.item-row.wns {
		background-color: cyan;
	}

	.inp-container {
		animation: fade-in ease-in 500ms;
		width: 34px;
		height: 34px;
		transition-duration: 2500ms;
		background-color: transparent;
	}

	.inp-container.wns {
		background-color: red;
	}

	.inp-item {
		padding: 2px;
		margin: 2px;
		width: 30px;
		height: 30px;
	}

	.zh {
		z-index: -1;
		position: absolute;
	}

	.zh-cov {
		z-index: -1;
		position: absolute;
		height: 100%;
		width: 100%;
		background-color: white;
	}

	.modal-container {
		display: none;
		position: fixed;
		width: 100vw;
		height: 100vh;
		top: 0;
		left: 0;
		background-color: rgba(0, 0, 0, 0.2);
	}

	.modal-container.show {
		display: flex;
	}

	.modal {
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.modal-content {
		border-radius: 12px;
		background-color: white;
		box-shadow: 0px 10px 30px 1px;
		padding: 40px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		justify-content: center;
		align-items: center;
	}

	@keyframes fade-in {
		0% {
			/*opacity: 0;*/
		}

		100% {
			/*opacity: 1;*/
		}
	}
</style>
