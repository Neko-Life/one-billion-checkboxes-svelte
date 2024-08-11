<script lang="ts">
	import { onMount } from 'svelte';
	import { SERVER_DOMAIN_URL } from '$lib/config';

	interface IItem {
		idx: number;
		loaded: boolean;
		active: boolean;
	}

	const maxIdx = 999_999_999;
	let maxRow = 0;

	let socket: WebSocket;

	let wsStatus = -1;

	let innerWidth: number = 0;
	let innerHeight: number = 0;

	let startNum = 0;
	let cboxes: Map<number, IItem> = new Map();
	let items: IItem[][] = [];

	let contentContainerRef: HTMLDivElement;
	let listRef: HTMLElement;
	let topRef: HTMLDivElement;
	let bottomRef: HTMLDivElement;

	let testCboxRow: HTMLDivElement | undefined;
	let testCbox: HTMLDivElement;

	let widthPerRow: number = 0;
	let widthPerCBox: number = 0;

	let shownRow = 0;
	let itemPerRow = 0;

	let userCount = 0;
	let contentPT: number = 0;

	$: if (innerWidth) {
		let update = false;
		if (testCboxRow && widthPerRow != testCboxRow.clientWidth) {
			widthPerRow = testCboxRow.clientWidth;
			update = true;
		}

		if (testCbox && widthPerCBox != testCbox.clientWidth) {
			widthPerCBox = testCbox.clientWidth;
			update = true;
		}
		if (update) updateItems(true);
	}

	$: if (innerHeight) updateItems(true);

	const getItem = (i: number) => {
		return cboxes.get(i) || { idx: i, loaded: false, active: false };
	};

	const setItem = (i: number, cbox: IItem) => {
		return cboxes.set(i, cbox);
	};

	const updateItems = (recalculateItemPerRow: boolean = false) => {
		if (recalculateItemPerRow) {
			if (!testCboxRow || !listRef /* || !contentContainerRef*/) return;

			//const contentH = `${listRef.clientHeight + testCboxRow.clientHeight}px`;
			//contentContainerRef.style.minHeight = contentH;
			//contentContainerRef.style.height = contentH;
			//contentContainerRef.style.maxHeight = contentH;
			//contentContainerRef.style.top = `-${testCboxRow.clientHeight}px`;

			itemPerRow = Math.floor(widthPerRow / widthPerCBox);
			maxRow = Math.ceil(listRef.clientHeight / testCboxRow.clientHeight) + 2;

			items = [];

			const toRow = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ maxRow;
			for (let i = 0; i < toRow; i++) {
				const row: IItem[] = [];
				const start = startNum + i * itemPerRow;
				const end = start + itemPerRow;

				for (let j = start; j < end; j++) {
					const cbox = getItem(j);
					row.push(cbox);
					setItem(j, cbox);
					if (j >= maxIdx) break;
				}

				items.push(row);
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
					items.shift();
					const lastRow = items[items.length - 1];
					const lastItem = lastRow[lastRow.length - 1];
					const row = [];
					for (let i = lastItem.idx + 1; i < lastItem.idx + 1 + itemPerRow; i++) {
						lid = i;
						row.push(getItem(i));
						if (lid >= maxIdx) break;
					}
					items.push(row);
					if (lid >= maxIdx) break;
				}
				items = items;
			}

			// else nothing to do
		}

		console.log({ items, itemPerRow, startNum });
	};

	const handleScroll = (event: Event & { target: EventTarget & any }) => {
		if (!testCboxRow || !event.target || !topRef || !listRef || !maxRow) return;
		console.log(event, topRef, listRef);

		const vPort = event.target;
		const scrollBase: number = vPort.scrollTop;
		const scrollMax: number = vPort.scrollTopMax;

		if (!scrollMax) return;

		//const maxStartNum = Math.floor(maxIdx / (itemPerRow * maxRow));

		const skip = Math.floor(scrollBase / testCboxRow.clientHeight);

		const newStartNum = skip * itemPerRow;
		console.log({ startNum, newStartNum });
		if (startNum !== newStartNum) {
			startNum = newStartNum;
			updateItems(true);
		}

		//contentPT =
		//	testCboxRow.clientHeight -
		//	(scrollBase - testCboxRow.clientHeight * (skip - (startNum ? 0 : 1)));
		contentPT = testCboxRow.clientHeight * skip;
	};

	const handleReconnect = () => {
		// !TODO
		if (wsStatus != -1) return;
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

	onMount(() => {
		if (listRef) {
			const vPort = listRef; //.$$.ctx[2];
			vPort.addEventListener('scroll', handleScroll);
		}

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

		return () => {
			if (listRef) {
				const vPort = listRef; //.$$.ctx[2];
				vPort.removeEventListener('scroll', handleScroll);
			}

			if (socket && (!socket.CLOSED || !socket.CLOSING)) {
				socket.close();
			}
		};
	});

	let f: number = 0;
	let l: number = 0;

	const updateCBoxInfo = () => {
		// calculate row from checkbox info instead
		const firstRow = items[0];
		const first = firstRow?.[0];
		if (first) {
			f = first.idx;
		}

		const lastSeenRow = items[items.length - 1];
		const lastSeen = lastSeenRow ? lastSeenRow[lastSeenRow.length - 1] : null;
		if (lastSeen) {
			l = lastSeen.idx;
		}
	};

	$: if (items) updateCBoxInfo();

	const promptJumpToRow = () => {};
	const promptJumpToCheckbox = () => {};

	const handleJumpToRow = () => {};
	const handleJumpToCheckbox = () => {};

	let requiredHeight: number;
	let cH: number;
	const scrollTrigger = 500;
	$: {
		requiredHeight =
			testCboxRow && itemPerRow ? ((maxIdx + 1) / itemPerRow) * testCboxRow.clientHeight : 0;
		// split container into smaller part so browser will allow to render it
		cH = requiredHeight / scrollTrigger;
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="page-container">
	<div class="container">
		<header>
			<section class="info" aria-label="info">
				<p>Checkbox: {f + 1}# - {l ? l + 1 : Infinity}#</p>
				<p>
					Row: {(f ? f / itemPerRow : 0) + 1} - {(l - (itemPerRow - 1)) / itemPerRow + 1}
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

		<main aria-label="content">
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
                        -->
			<div bind:this={listRef} class="content-container">
				<div class="content">
					<div style="padding-top: {contentPT}px;"></div>
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
			</div>
			<div bind:this={bottomRef}></div>
		</main>
	</div>
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
		height: 10000000px;
	}

	.item-row {
		display: flex;
		justify-content: space-evenly;
		width: 100%;
	}

	.inp-container {
		animation: fade-in ease-in 500ms;
	}

	.inp-item {
		padding: 2px;
		width: 30px;
		height: 30px;
		margin: 2px;
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
