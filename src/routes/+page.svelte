<script lang="ts">
	import { onMount } from 'svelte';
	import { SERVER_DOMAIN_URL } from '$lib/config';

	interface IItem {
		idx: number;
		loaded: boolean;
		active: boolean;
	}

	const maxRow = 128;
	const maxIdx = 999_999_999;

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

	let testCboxRow: HTMLDivElement;
	let testCbox: HTMLDivElement;

	let widthPerRow: number = 0;
	let widthPerCBox: number = 0;

	let shownRow = 0;
	let itemPerRow = 0;

	let sStart: number = 0;
	let sEnd: number = 0;

	let userCount = 0;

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

	const getItem = (i: number) => {
		return cboxes.get(i) || { idx: i, loaded: false, active: false };
	};

	const setItem = (i: number, cbox: IItem) => {
		return cboxes.set(i, cbox);
	};

	const updateItems = (recalculateItemPerRow: boolean = false) => {
		if (recalculateItemPerRow) {
			itemPerRow = Math.floor(widthPerRow / widthPerCBox);

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

	const handleScroll = (event: Event & { currentTarget: EventTarget & any }) => {
		if (!testCboxRow || !event.currentTarget) return;

		const vPort = event.currentTarget;
		// !TODO
		//const scrollBase: number = vPort.scrollTop;
		//const scrollMax: number = vPort.scrollTopMax;
		const scrollBase: number = 0;
		const scrollMax: number = 0;

		if (!scrollMax) return;

		const oneFourth = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ scrollMax / 4;
		const mod = testCboxRow.clientHeight;
		let update = false;

		console.log({ oneFourth, scrollBase });

		const thirdFourth = oneFourth * 3;
		const maxStartNum = Math.floor(maxIdx / (itemPerRow * maxRow));

		if (scrollBase > thirdFourth && startNum < maxStartNum) {
			// scroll down
			const diff = scrollBase - thirdFourth;
			const entry = Math.ceil(diff / mod);

			const firstRow = items[0];
			if (!firstRow) throw Error('no way');
			const first = firstRow[0];
			if (!first) throw Error('what');
			startNum = first.idx + itemPerRow * entry;
			if (startNum > maxStartNum) startNum = maxStartNum;
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
			if (startNum < 0) startNum = 0;
			vPort.scrollTo(0, scrollBase + mod * entry);
			update = true;
		}

		console.log({ startNum, update });
		if (update) updateItems();
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

	let contentPT = 0; // can only be 0-(testCboxRow.clientHeight-1)
	let f: number = 0;
	let l: number = 0;

	const updateCBoxInfo = () => {
		console.log({ sStart, sEnd });
		// calculate row from checkbox info instead
		const firstRow = items[sStart];
		const first = firstRow?.[0];
		if (first) {
			f = first.idx;
		}

		const lastSeenRow = items[sEnd - 1];
		const lastSeen = lastSeenRow ? lastSeenRow[lastSeenRow.length - 1] : null;
		if (lastSeen) {
			l = lastSeen.idx;
		}
	};

	$: if (sStart || sEnd || items) updateCBoxInfo();

	const promptJumpToRow = () => {};
	const promptJumpToCheckbox = () => {};

	const handleJumpToRow = () => {};
	const handleJumpToCheckbox = () => {};

	let requiredHeight: number;
	let cH: number;
	const scrollTrigger = 5;
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
					Row: {(f ? Math.floor(f / itemPerRow) : 0) + 1} - {Math.floor(
						(l - (itemPerRow - 1)) / itemPerRow
					) + 1}
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
			<div class="content-container-container">
				<div bind:this={contentContainerRef} class="content-container">
					<div style="padding-top: {contentPT}px;">
						{#each items as item}
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
						{/each}
					</div>
				</div>
			</div>

			<div bind:this={testCboxRow} class="item-row zh">
				<div class="inp-container" bind:this={testCbox}>
					<input class="inp-item" type="checkbox" />
				</div>
			</div>
			<div class="zh-cov"></div>

			<!--
                        -->
			<div bind:this={topRef}></div>
			{#each new Array(scrollTrigger).fill(null) as i}
				<div style="min-height: {cH}px;" class="scroll-trigger">whats wrong w u?</div>
			{/each}
			<div bind:this={bottomRef}></div>

			<!--
			<VirtualList
				height="{testCboxRow && itemPerRow
					? ((maxIdx + 1) / itemPerRow) * testCboxRow.clientHeight
					: 0}px"
				bind:this={listRef}
				{items}
				let:item
				bind:start={sStart}
				bind:end={sEnd}
			>
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
			</VirtualList>
                -->
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
		overflow: scroll;
		position: relative;
	}

	.content-container-container {
		position: sticky;
		top: 0;
		max-height: 0px;
	}

	.content-container {
		position: absolute;
		top: 0;
		left: 0;
		min-width: 100%;
		width: 100%;
		max-width: 100%;
		overflow: hidden;
	}

	.item-row {
		display: flex;
		justify-content: space-evenly;
		width: 100%;
	}

	.inp-container {
		padding: 2px;
		animation: fade-in ease-in 500ms;
	}

	.inp-item {
		width: 30px;
		height: 30px;
		margin: 4px;
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
			opacity: 0;
		}

		100% {
			opacity: 1;
		}
	}
</style>
