<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SERVER_DOMAIN_URL } from '$lib/config';

	interface IItem {
		idx: number;
		loaded: boolean;
		active: boolean;
	}
	let modalShow = false;

	const maxIdx = 999_999_999;
	let maxRow = 0;

	let socket: WebSocket;

	let wsStatus = -1;

	let innerWidth: number = 0;
	let innerHeight: number = 0;

	let startNum = 999_999_000;
	let cboxes: Map<number, IItem> = new Map();
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
		return cboxes.get(i) || { idx: i, loaded: false, active: false };
	};

	const setItem = (i: number, cbox: IItem) => {
		return cboxes.set(i, cbox);
	};

	let toggleRounding = false;
	const updateItemPerRow = () => {
		if (!hasItemPerRowSet) {
			itemPerRow = Math.floor(widthPerRow / widthPerCBox);
		}

		if (testCboxRow && listRef) {
			const maxR = Math.ceil(listRef.clientHeight / testCboxRow.clientHeight);
			maxRow = maxR + 30;
			maxStartNum = maxIdx + 1 - maxRow * itemPerRow + itemPerRow;
		}

		startNum = startNum - (startNum % itemPerRow);
		startNum += startNum > 0 && toggleRounding ? itemPerRow : 0;
		toggleRounding = !toggleRounding;
		if (startNum < 0) startNum = 0;
		if (startNum > maxStartNum) startNum = maxStartNum;
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
					setItem(j, cbox);
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

		console.log({ items, itemPerRow, startNum });
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

			console.log({
				elRects,
				containerRects,
				topRects,
				secondYes: elRects.bottom < topRects.bottom,
				firstYes: elRects.bottom > containerRects.top
			});

			if (elRects.bottom > containerRects.top && elRects.bottom < topRects.bottom) {
				topRects = elRects;
				top = el;
				console.log({ topSetTo: el });
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

		console.log({
			top,
			topRects,
			bottom,
			bottomRects,
			topInp,
			bottomInp,
			startIdx,
			endIdx,
			containerRects
		});
	};

	const handleScroll = updateSeenStartEnd;

	const handleScrollEnd = async (event: Event & { target: EventTarget & any }) => {
		if (!testCboxRow || !event.target || !topRef || !listRef || !maxRow) return;

		console.log(event, topRef, listRef);

		updateItemPerRow();

		const vPort = event.target;
		const scrollBase: number = vPort.scrollTop;
		const scrollMax: number = vPort.scrollTopMax;

		if (!scrollMax) return;

		const oneFourth = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ scrollMax / 4;
		const mod = testCboxRow.clientHeight;
		let update = false;

		const thirdFourth = oneFourth * 3;

		console.log({ oneFourth, scrollBase, startNum, maxStartNum });

		if (scrollBase > thirdFourth && startNum < maxStartNum && endIdx < maxIdx) {
			// scroll down
			const diff = scrollBase - thirdFourth;
			const entry = Math.ceil(diff / mod);

			const firstRow = items[0];
			if (!firstRow) throw Error('no way');
			const first = firstRow[0];
			if (!first) throw Error('what');
			startNum = first.idx + itemPerRow * entry;
			console.log('Update from scrolldown');
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
			console.log('Update from scrollup');
			vPort.scrollTo(0, scrollBase + mod * entry);
			update = true;
		}

		console.log({ startNum, update });
		if (update) updateItems();
	};

	const handleReconnect = () => {
		// !TODO
		if (wsStatus != -1) return;
		socketCleanUp();
		socketInit();
	};

	const findActiveIdx = (item: IItem) => {
		return getItem(item.idx);
	};

	const isActive = (item: IItem) => {
		//console.log({ isActive: item, actives });
		return !!findActiveIdx(item).active;
	};

	const removeActive = (item: IItem) => {
		const idx = findActiveIdx(item);

		if (idx.active) {
			setItem(idx.idx, { ...idx, active: false });
			return true;
		}

		return false;
	};

	const addActive = (item: IItem) => {
		const idx = findActiveIdx(item);

		if (!idx.active) {
			setItem(idx.idx, { ...idx, active: true });
			return true;
		}

		return false;
	};

	const sendSwitch = (i: number) => {
		if (wsStatus !== 0) return;
		socket.send(i.toString());
	};

	const sendLoadReq = (i: number) => {
		if (wsStatus !== 0) return;
		socket.send(`gcv;${i}`);
	};

	const switchActive = (item: IItem) => {
		console.log({ switchActive: item });
		sendSwitch(item.idx);
		if (removeActive(item)) return;
		addActive(item);
	};

	const handleCBoxClick = (
		e: MouseEvent & {
			currentTarget: EventTarget & HTMLInputElement;
		},
		item: IItem,
		row: IItem[]
	) => {
		switchActive(item);
	};

	const handleSocketOpen = (ev: Event) => {
		wsStatus = 0;

		socket.send('gv;');
	};

	const handleSocketMessage = async (ev: MessageEvent<Blob>) => {
		const data = await ev.data.text();
		console.log({ data });
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

	const promptJumpToRow = () => {};
	const promptJumpToCheckbox = () => {};

	const handleJumpToRow = () => {};
	const handleJumpToCheckbox = () => {};

	//$: {
	//requiredHeight =
	//	testCboxRow && itemPerRow ? ((maxIdx + 1) / itemPerRow) * testCboxRow.clientHeight : 0;
	// split container into smaller part so browser will allow to render it
	//cH = requiredHeight / scrollTrigger;
	//}

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
								<div class="inp-container">
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

<div class="modal-container {modalShow ? 'show' : ''}"></div>

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

	.content-container {
		/*position: absolute;
		left: 0;
		min-width: 100%;
		width: 100%;
		max-width: 100%;*/
		overflow: scroll;
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

	.scroll-trigger {
		transform: translateX(1000%);
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
