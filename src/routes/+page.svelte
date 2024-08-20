<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SERVER_DOMAIN_URL } from '$lib/config';

	interface IItem {
		idx: number;
	}

	interface BitInfo {
		page: number;
		element: number;
		state: 0 | 1;
	}

	const SIZE_PER_PAGE = 1_000_000;

	let modalShow = false;

	const maxIdx = 999_999_999;
	const maxCacheSize = 131072; // cboxes cache limit
	let maxRow = 0;
	const addMaxRow = 64;

	let socket: WebSocket;

	let wsStatus = -1;

	let innerWidth: number = 0;
	let innerHeight: number = 0;

	let startNum = 0;

	let loadReqQueue: number[] = [];
	let cboxes: Map<number, Uint8Array> = new Map();
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
			maxRow = maxR + addMaxRow;
			maxStartNum = maxIdx + 1 - maxRow * itemPerRow + itemPerRow;
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
					if (j > maxIdx) break;
					const cbox = getItem(j);
					row.push(cbox);
				}

				if (row.length) items.push(row);
				if (row[row.length - 1].idx >= maxIdx) break;
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
					if (lid > maxIdx) break;
					const lastRow = items[items.length - 1];
					const lastItem = lastRow[lastRow.length - 1];
					lid = lastItem.idx;
					if (lid > maxIdx) break;
					items.shift();
					const row = [];
					for (let i = lastItem.idx + 1; i < lastItem.idx + 1 + itemPerRow; i++) {
						lid = i;
						if (lid > maxIdx) break;
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

		//console.log({ oneFourth, scrollBase, startNum, maxStartNum });

		if (scrollBase > thirdFourth && startNum < maxStartNum && endIdx < maxIdx) {
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
			const entry = Math.ceil(diff / mod);

			// !TODO: make this to allow jumping to specific index
			const firstRow = items[0];
			if (!firstRow) throw Error('no way!');
			const first = firstRow[0];
			if (!first) throw Error('what!');
			startNum = first.idx - itemPerRow * entry;
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

	const getElementData = (pageData: Uint8Array | undefined, idx: number) => {
		if (!pageData) return;

		const element = Math.floor((idx % SIZE_PER_PAGE) / 8);
		return pageData.at(element);
	};

	const getState = (idx: number): BitInfo => {
		const returnError = () =>
			Object.freeze({
				state: 0,
				page: 0,
				element: 0
			});

		const page = Math.floor(idx / SIZE_PER_PAGE);
		const pageData = cboxes.get(page);
		if (!pageData) return returnError();

		const element = Math.floor((idx % SIZE_PER_PAGE) / 8);
		const elementData = pageData.at(element);
		if (typeof elementData === 'undefined') return returnError();

		const bit = 1 << (idx % SIZE_PER_PAGE) % 8;

		return {
			state: elementData & bit ? 1 : 0,
			page,
			element
		};
	};

	const setPageElement = (pageData: Uint8Array, v: number, elIdx: number) => {
		pageData.set([v], elIdx);
	};

	const isActive = (item: IItem) => {
		//console.log({ isActive: item, actives });
		return getState(item.idx).state === 1;
	};

	const removeActive = (item: IItem) => {
		const s = getState(item.idx);
		if (s.state) {
		}

		return false;
	};

	const addActive = (item: IItem) => {
		return false;
	};

	const sendSwitch = (i: number) => {
		if (wsStatus !== 0) return -1;
		socket.send(i.toString());

		return 0;
	};

	//let start = -1;
	//let end = -1;
	const sendLoadReq = (i: number) => {
		if (wsStatus !== 0) {
			if (!loadReqQueue.includes(i)) {
				loadReqQueue.push(i);

				if (loadReqQueue.length > maxCacheSize) {
					const first = loadReqQueue[0];
					const b = i > first ? i : first;
					const s = first > i ? i : first;

					const last = loadReqQueue[loadReqQueue.length - 1];
					const b2 = i > last ? i : last;
					const s2 = last > i ? i : last;

					let rm;
					if (b - s >= b2 - s2) rm = loadReqQueue.shift();
					else rm = loadReqQueue.pop();

					if (rm) {
						cboxes.delete(rm);
					}
				}
			}

			return -1;
		}

		//if (start === -1) {
		//	start = i;
		//}
		//
		//if ((end = -1)) {
		//	end = i;
		//	return 0;
		//}
		//
		//if (i !== end + 1) {
		//	socket.send(`gcvr;${start}-${end}`);
		//	start = -1;
		//	end = -1;
		//} else
		socket.send(`gcv;${i}`);

		return 0;
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

	let s = false;
	let k = 'ehEk';
	let o = k.length;
	let g = 0;

	const handleSocketOpen = (ev: Event) => {
		s = false;
		k = 'ehEk';
		o = k.length;
		g = 0;
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

	let awaitingState = false;
	const handleSocketMessage = async (ev: MessageEvent<Blob>) => {
		if (awaitingState)
			try {
				let sliced;

				if (
					ev.data.size > 3 &&
					(sliced = ev.data.slice(0, 3)) &&
					(await sliced.text()) === 'e;\n'
				) {
					const u8arr = new Uint8Array(await ev.data.slice(3).arrayBuffer());

					console.log(u8arr);

					updateItems();

					return;
				}
			} catch (e) {
				socketPayloadErrClose(e);
				return;
			}

		let data: string;
		try {
			data = await ev.data.text();
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

		if (data === 'l;') {
			s = true;
			return;
		}

		if (s) {
			if (data.length > 2) {
				const r = parseInt(data.substring(2));

				if (!Number.isNaN(r)) o = r;
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
				addActive({ idx: n } as any);
			} else removeActive({ idx: n } as any);

			return;
		}
	};

	const handleSocketClose = (ev: CloseEvent) => {
		// !TODO: toast
		wsStatus = -1;
		for (const [, v] of cboxes) {
			v.loaded = false;
		}
	};

	const socketInit = () => {
		socket = new WebSocket(`${SERVER_DOMAIN_URL}/game`);
		(window as any).sock = socket;
		wsStatus = 1;

		socket.onopen = (...args) => {
			console.log('[OPEN]', ...args);
			handleSocketOpen(args[0]);
		};

		socket.onmessage = (...args) => {
			console.log('[MESSAGE]', ...args);
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
								<div class="inp-container {i.idx === wannaSee ? 'wns' : ''}">
									<input
										class="inp-item"
										type="checkbox"
										data-idx={i.idx}
										checked={isActive(i)}
										on:click={(e) => handleCBoxClick(e, i, item)}
									/>
								</div>
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
