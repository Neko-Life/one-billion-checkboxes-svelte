<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SERVER_DOMAIN_URL } from '$lib/config';
	import { type BitInfo, type IItem } from '$lib/interfaces';
	import {
		BASE_MIN_RENDER_ROW,
		MAX_LOAD_REQ_QUEUE_SIZE,
		MAX_CBOX_IDX,
		SIZE_PER_PAGE,
		USE_MAX_BIT_COUNT
	} from '$lib/constants';
	import { getBitState, setPageElement } from '$lib/bitUtils';

	let modalShow = false;

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

	const getItem = (i: number) => {
		return { idx: i };
	};

	let toggleRounding = false;
	let wannaSee = -1;
	const updateItemPerRow = () => {
		if (!hasItemPerRowSet) {
			itemPerRow = Math.floor(widthPerRow / widthPerCBox);
		}

		if (testCboxRow && listRef) {
			const maxR = Math.ceil(listRef.clientHeight / testCboxRow.clientHeight);
			maxRow = maxR + BASE_MIN_RENDER_ROW;
			maxStartNum = MAX_CBOX_IDX + 1 - maxRow * itemPerRow + itemPerRow;
		}

		startNum = startNum - (startNum % itemPerRow);
		startNum += startNum > 0 && toggleRounding ? itemPerRow : 0;
		toggleRounding = !toggleRounding;
		if (startNum < 0) startNum = 0;
		if (startNum > maxStartNum) {
			wannaSee = startNum;

			startNum = maxStartNum;
		}
	};

	const scrollToWannaSee = async () => {
		if (wannaSee === -1) return;

		await tick();

		const to = document.querySelector(`input[data-idx="${wannaSee}"]`);
		if (to) {
			to.scrollIntoView({ behavior: 'smooth' });
		}

		wannaSee = -1;
	};

	const updateItems = async (recalculateItemPerRow: boolean = false) => {
		await tick();
		updateWidth(true);
		if (recalculateItemPerRow) {
			if (!testCboxRow || !listRef || !contentRef) return;

			updateItemPerRow();

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
		scrollToWannaSee();
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
	};

	const handleScroll = updateSeenStartEnd;

	const handleScrollEnd = async (event: Event & { target: EventTarget & any }) => {
		if (!testCboxRow || !event.target || !topRef || !listRef || !maxRow) return;

		//console.log(event, topRef, listRef);

		updateItemPerRow();

		const vPort = event.target;
		const scrollBase: number = vPort.scrollTop;
		const scrollMax: number = vPort.scrollTopMax;

		if (!scrollMax) return;

		const oneFourth = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ scrollMax / 4;
		const mod = testCboxRow.clientHeight;
		let update = false;

		const thirdFourth = oneFourth * 3;
		const originalStartNum = startNum;

		//console.log({ oneFourth, scrollBase, startNum, maxStartNum });

		if (scrollBase > thirdFourth && startNum < maxStartNum && endIdx < MAX_CBOX_IDX) {
			// scroll down
			const diff = scrollBase - thirdFourth;
			const entry = Math.ceil(diff / mod);

			const firstRow = items[0];
			if (!firstRow) throw Error('no way');
			const first = firstRow[0];
			if (!first) throw Error('what');
			startNum = first.idx + itemPerRow * entry;
			vPort.scrollTo(0, scrollBase - mod * entry);
			update = true;
		} else if (scrollBase < oneFourth && startNum > 0) {
			// scroll up
			const diff = oneFourth - scrollBase;
			let entry = Math.ceil(diff / mod);

			// !TODO: make this to allow jumping to specific index
			const firstRow = items[0];
			if (!firstRow) throw Error('no way!');
			const first = firstRow[0];
			if (!first) throw Error('what!');
			startNum = first.idx - itemPerRow * entry;
			if (startNum < 0) {
				startNum = 0;
				entry = originalStartNum / itemPerRow - 1;
			}

			vPort.scrollTo(0, scrollBase + mod * entry);
			update = true;
		}

		//console.log({ startNum, update });
		if (update) updateItems();
	};

	const handleReconnect = () => {
		// !TODO
		if (wsStatus != -1) return;
		socketCleanUp();
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

		const page = Math.floor(idx / SIZE_PER_PAGE);
		const pageData = cboxes.get(page);
		if (!pageData) {
			sendLoadReq(page);
			return returnError();
		}

		const elementIdx = Math.floor((idx % SIZE_PER_PAGE) / USE_MAX_BIT_COUNT);
		const elementValue = pageData.getUint8(elementIdx);
		//console.log({ pageData });
		console.log({ elementValue, elementIdx, idx });
		if (typeof elementValue === 'undefined') return returnError();

		const bit = 1 << (idx % SIZE_PER_PAGE) % USE_MAX_BIT_COUNT;
		console.log({ bit, idx });

		const ret = Object.freeze({
			state: getBitState(elementValue, bit),
			page,
			elementIdx,
			bit,
			pageData,
			elementValue
		});

		//console.log(ret);

		return ret;
	};

	const isActive = (item: IItem) => {
		//console.log({ isActive: item, actives });
		const state = getState(item.idx);

		console.log({ item, state, page: state.page });

		return state.state === 1;
	};

	const removeActive = (item: IItem) => {
		const s = getState(item.idx);
		if (s.state) {
			setPageElement(s.pageData, s.elementValue & ~s.bit, s.elementIdx);

			console.log({ removedActive: item.idx });

			return true;
		}

		return false;
	};

	const addActive = (item: IItem) => {
		const s = getState(item.idx);
		if (!s.state) {
			setPageElement(s.pageData, s.elementValue | s.bit, s.elementIdx);

			console.log({ addActive: item.idx });

			return true;
		}

		return false;
	};

	const sendSwitch = (i: number) => {
		if (wsStatus !== 0) return -1;
		socket.send(i.toString());

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

	const switchActive = (item: IItem) => {
		//console.log({ switchActive: item });

		if (sendSwitch(item.idx)) return -1;
		if (removeActive(item)) return 0;
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
		if (switchActive(item)) e.preventDefault();
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

				console.log({ awaitingState, u8arr });

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
			data = String.fromCharCode.apply(null, new Uint8Array(ev.data) as any);
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

			console.log({ g, k, o, data });
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

		if (s) {
			if (data.length > 2) {
				const r = parseInt(data.substring(2));

				console.log({ r });

				if (!Number.isNaN(r) && r) {
					o = r;
				}
			}

			s = false;

			return;
		}

		if (data === 'h;') {
			console.log({ s, k, o, g });
			socket.send(k);
			return;
		}

		if (data.startsWith('s;')) {
			const matches = data.match(/;(\d+);/);
			const n = parseInt(matches?.[1] || 'e');

			if (Number.isNaN(n)) {
				console.error('Invalid packet received');
				socketCleanUp();
				return;
			}

			if (data.endsWith('1')) {
				addActive({ idx: n });
			} else removeActive({ idx: n });

			return;
		}
	};

	const tryHandleSocketMessage = async () => {
		if (handlingSocketMessage) return;
		handlingSocketMessage = true;

		console.log({ socketMessagesBefore: socketMessages });
		let inc = 0;
		for (const ev of socketMessages) {
			await handleSocketMessageEvent(ev);
			inc++;
		}
		console.log({ socketMessagesAfter: socketMessages, inc });
		socketMessages = [];

		handlingSocketMessage = false;
	};

	const handleSocketMessage = (ev: MessageEvent<ArrayBuffer>) => {
		socketMessages.push(ev);
		tryHandleSocketMessage();
	};

	const handleSocketClose = (ev: CloseEvent) => {
		// !TODO: toast
		wsStatus = -1;
	};

	const socketInit = () => {
		socket = new WebSocket(`${SERVER_DOMAIN_URL}/game`);
		socket.binaryType = 'arraybuffer';

		(window as any).sock = socket;
		wsStatus = 1;

		socket.onopen = (...args) => {
			console.log('[OPEN]', ...args);
			handleSocketOpen(args[0]);
		};

		socket.onmessage = (...args) => {
			//console.log('[MESSAGE]', ...args);
			handleSocketMessage(args[0]);
		};
		socket.onerror = (...args) => console.error('[ERROR]', ...args);

		socket.onclose = (...args) => {
			console.warn('[CLOSE]', ...args);
			handleSocketClose(args[0]);
		};
	};

	const socketCleanUp = () => {
		if (socket && (!socket.CLOSED || !socket.CLOSING)) {
			socket.close();
		}
	};

	onMount(() => {
		(window as any).getState = getState;

		if (listRef) {
			const vPort = listRef; //.$$.ctx[2];
			vPort.addEventListener('scrollend', handleScrollEnd);
			vPort.addEventListener('scroll', handleScroll);
		}

		socketInit();

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
		modalShow = true;
	};

	const promptJumpToCheckbox = () => {
		modalShow = true;
	};

	const handleJumpToRow = () => {};
	const handleJumpToCheckbox = () => {};

	$: fStr = Math.floor(f ? f / itemPerRow : 0) + 1;
	$: lStr = Math.floor(l ? (l - (itemPerRow - 1)) / itemPerRow : 0) + 1;
	//$: console.log({ f, l, fStr, lStr, itemPerRow });
	//$: console.log({ itemPerRow, innerHeight, maxRow, testCboxRowHeight: testCboxRow?.clientHeight });
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="page-container">
	<div class="container">
		<header>
			<section class="info" aria-label="info">
				<p>Checkbox: {f + 1}# - {l ? l + 1 : Infinity}#</p>
				<p>
					Row: {fStr} - {lStr}
				</p>
				<p>{itemPerRow} Column{itemPerRow === 1 ? '' : 's'}</p>

				<button on:click={promptJumpToRow}>Jump to row</button>
				<button on:click={promptJumpToCheckbox}>Jump to checkbox</button>
			</section>
			<section class="title-container" aria-label="title">
				<h1>A Billion Checkboxes</h1>
			</section>
			<section class="status" aria-label="status">
				{#if userCount > 0}
					<p>{userCount} user{userCount == 1 ? '' : 's'} playing</p>
				{/if}

				{#if wsStatus === 0}
					<p>Connected</p>
				{:else if wsStatus === 1}
					<p>Connecting...</p>
				{:else if wsStatus === -1}
					<button on:click={handleReconnect}>Reconnect</button>
				{/if}
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
						<div class="item-row">
							{#each item as i}
								{#key i.idx}
									<div class="inp-container {i.idx === wannaSee ? 'wns' : ''}">
										<input
											class="inp-item"
											type="checkbox"
											data-idx={i.idx}
											checked={isActive(i)}
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

<div class="modal-container {modalShow ? 'show' : ''}">SHOWW</div>

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

	.info {
		font-weight: 600;
		font-style: italic;
	}

	.title-container {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.title-container h1 {
		font-size: 36px;
	}

	.status {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: flex-end;
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
	}

	.inp-container {
		animation: fade-in ease-in 500ms;
		width: 34px;
		height: 34px;
	}

	.inp-container.wns {
		background-color: yellow;
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
	}

	.modal-container.show {
		display: flex;
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
