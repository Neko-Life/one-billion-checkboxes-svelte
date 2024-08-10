<script lang="ts">
	import VirtualList from '@sveltejs/svelte-virtual-list';
	import { onMount } from 'svelte';

	interface IItem {
		idx: number;
	}

	const maxRow = 256;
	const maxIdx = 999_999_999;

	let actives: number[] = [];
	let connected = false;

	let innerWidth: number = 0;
	let innerHeight: number = 0;

	let startNum = 0;
	//let cboxes: Map<number, IItem> = new Map();
	let items: IItem[][] = [];

	let testCboxRow: HTMLDivElement;
	let testCbox: HTMLDivElement;
	let widthPerRow: number = 0;
	let widthPerCBox: number = 0;
	let itemPerRow = 0;
	let updating = false;

	let sStart: number = 0;
	let sEnd: number = 0;

	const updateItems = (recalculateItemPerRow: boolean = false) => {
		//if (updating) return;
		//updating = true;

		if (recalculateItemPerRow) {
			itemPerRow = Math.floor(widthPerRow / widthPerCBox);

			items = [];

			const toRow = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ maxRow;
			for (let i = 0; i < toRow; i++) {
				const row: IItem[] = [];
				const start = startNum + i * itemPerRow;
				const end = start + itemPerRow;

				for (let j = start; j < end; j++) {
					const cbox = /*cboxes.get(j) ||*/ { idx: j };
					row.push(cbox);
					//cboxes.set(j, cbox);
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
				const rpt = (firstItem.idx - startNum) / itemPerRow;
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
						row.push({ idx: i });
					}
					if (sb) break;
					items.unshift(row);
				}
				items = items;
			} else if (firstItem.idx < startNum) {
				const rpt = (startNum - firstItem.idx) / itemPerRow;
				// scrolling down, shift and push
				let lid = 0;
				for (let j = 0; j < rpt; j++) {
					items.shift();
					const lastRow = items[items.length - 1];
					const lastItem = lastRow[lastRow.length - 1];
					const row = [];
					for (let i = lastItem.idx + 1; i < lastItem.idx + 1 + itemPerRow; i++) {
						lid = i;
						row.push({ idx: i });
						if (lid >= maxIdx) break;
					}
					items.push(row);
					if (lid >= maxIdx) break;
				}
				items = items;
			}

			// else nothing to do
		}

		//updating = false;

		console.log({ items });
	};

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

	const handleScroll = (event: Event & { currentTarget: EventTarget & any }) => {
		if (!testCboxRow || updating || !event.currentTarget) return;
		const vPort = event.currentTarget;
		const scrollBase: number = vPort.scrollTop;
		const scrollMax: number = vPort.scrollTopMax;
		const oneFourth = /*cboxes.size ? Math.ceil(cboxes.size / itemPerRow) :*/ scrollMax / 4;
		const mod = testCboxRow.clientHeight; /* + testCboxRow.clientHeight / 2*/
		let update = false;

		console.log({ oneFourth, scrollBase });

		let entry = -1;
		const thirdFourth = oneFourth * 3;
		if (scrollBase > thirdFourth && startNum < maxIdx) {
			// scroll down
			const diff = scrollBase - thirdFourth;
			entry = Math.ceil(diff / mod);

			//const firstRow = items.shift();
			const firstRow = items[0];
			if (!firstRow) throw Error('no way');
			//const last = firstRow.pop();
			const first = firstRow[0];
			if (!first) throw Error('what');
			startNum = first.idx + itemPerRow * entry;
			//if (startNum > ) startNum = 0;
			//items.shift();
			vPort.scrollTo(0, scrollBase - mod * entry);
			update = true;
		} else if (scrollBase < oneFourth && startNum > 0) {
			// scroll up
			const diff = oneFourth - scrollBase;
			entry = Math.ceil(diff / mod);

			// !TODO: make this to allow jumping to specific index
			const firstRow = items[0];
			if (!firstRow) throw Error('no way!');
			const first = firstRow[0];
			if (!first) throw Error('what!');
			startNum = first.idx - itemPerRow * entry;
			//if (startNum < 0) startNum = 0;
			//items.pop();
			vPort.scrollTo(0, scrollBase + mod * entry);
			update = true;
		}
		console.log({ startNum, entry }, vPort);
		// !TODO: temp force recalculating everything
		// it should do some loop if it were gonna push/pop only
		// when entry > 1
		if (update) updateItems(/*entry > 1*/);
	};

	const handleReconnect = () => {
		// !TODO
		connected = true;
	};

	const findActiveIdx = (item: IItem) => {
		return actives.findIndex((v) => v === item.idx);
	};

	const isActive = (item: IItem) => {
		//console.log({ isActive: item, actives });
		return findActiveIdx(item) !== -1;
	};

	const removeActive = (item: IItem) => {
		const idx = findActiveIdx(item);

		if (idx !== -1) {
			actives.splice(idx, 1);
			return true;
		}

		return false;
	};

	const addActive = (item: IItem) => {
		const idx = findActiveIdx(item);

		if (idx === -1) {
			actives = [...actives, item.idx];
			return true;
		}

		return false;
	};

	const switchActive = (item: IItem) => {
		console.log({ switchActive: item });
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

	let listRef: any;
	onMount(() => {
		if (listRef) {
			const vPort: HTMLDivElement = listRef.$$.ctx[2];
			vPort.addEventListener('scrollend', handleScroll);
		}

		return () => {
			if (listRef) {
				const vPort: HTMLDivElement = listRef.$$.ctx[2];
				vPort.removeEventListener('scrollend', handleScroll);
			}
		};
	});
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="page-container">
	<div class="container">
		<header>
			<section aria-label="info">
				<p>{innerWidth}W - {innerHeight}H</p>
				<p>{widthPerRow}R - {widthPerCBox}C</p>
				<p>{sStart}S - {sEnd}E</p>
			</section>
			<section class="title-container" aria-label="title">
				<h1>A Billion Checkboxes</h1>
			</section>
			<section class="status" aria-label="status">
				{#if connected}
					Connected
				{:else}
					<button on:click={handleReconnect}>Reconnect</button>
				{/if}
			</section>
		</header>

		<main aria-label="content">
			<div bind:this={testCboxRow} class="item-row zh">
				<div class="inp-container" bind:this={testCbox}>
					<input class="inp-item" type="checkbox" />
				</div>
			</div>
			<div class="zh-cov"></div>

			<VirtualList bind:this={listRef} {items} let:item bind:start={sStart} bind:end={sEnd}>
				<div class="item-row">
					{#each item as i}
						{#key i.idx}
							<div class="inp-container">
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
			</VirtualList>
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

	.title-container {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.status {
		display: flex;
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

	.item-row {
		display: flex;
		justify-content: space-evenly;
		width: 100%;
	}

	.inp-container {
		padding: 2px;
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
</style>
