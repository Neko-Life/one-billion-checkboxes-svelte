<script lang="ts">
	import VirtualList from '@sveltejs/svelte-virtual-list';

	interface IItem {
		idx: number;
		active: boolean;
	}

	const maxRow = 256;
	const maxIdx = 999_999_999;

	let connected = false;

	let innerWidth: number = 0;
	let innerHeight: number = 0;

	let startNum = 0;
	let cboxes: Map<number, IItem> = new Map();
	let items: IItem[][] = [];

	let testCboxRow: HTMLDivElement;
	let testCbox: HTMLDivElement;
	let widthPerRow: number = 0;
	let widthPerCBox: number = 0;
	let itemPerRow = 0;
	let lastIdx = 0;
	let updating = false;

	const updateItems = () => {
		//if (updating) return;
		//updating = true;

		lastIdx = startNum;
		itemPerRow = Math.floor(widthPerRow / widthPerCBox);

		items = [];

		const toRow = cboxes.size ? Math.ceil(cboxes.size / itemPerRow) : maxRow;
		for (let i = 0; i < toRow; i++) {
			const row: IItem[] = [];
			const upto = lastIdx + itemPerRow;

			for (let j = lastIdx; j < upto; j++) {
				const cbox = cboxes.get(j) || { idx: j, active: false };
				row.push(cbox);
				cboxes.set(j, cbox);
				if (j >= maxIdx) break;
			}

			lastIdx = upto;
			items.push(row);
			if (lastIdx >= maxIdx) break;
		}
		//updating = false;

		console.log(items);
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
		if (update) updateItems();
	}

	let sStart: number = 0;
	let sEnd: number = 0;
	let listRef: any;
	$: if (listRef && testCboxRow) {
		const oneThird = (cboxes.size ? Math.ceil(cboxes.size / itemPerRow) : maxRow) / 3;
		const vPort: any = listRef.$$.ctx[2];
		//const scrollOneThird = vPort.scrollTopMax / 3;
		//const sub = testCboxRow.clientHeight + testCboxRow.clientHeight / 2;
		let update = false;
		console.log({ sStart, sEnd, oneThird });
		if (sEnd > oneThird * 2 && startNum < maxIdx) {
			//const firstRow = items.shift();
			const firstRow = items[0];
			if (!firstRow) throw Error('no way');
			//const last = firstRow.pop();
			const last = firstRow[firstRow.length - 1];
			if (!last) throw Error('what');
			startNum = last.idx + 1;
			//vPort.scrollTo(0, scrollOneThird * 2 - sub);
			update = true;
		} else if (sStart < oneThird && startNum > 0) {
                        // !TODO: make this to allow jumping to specific index
			//const firstRow = items[0];
			//if (!firstRow) throw Error('no way!');
			//const first = firstRow[0];
			//if (!first) throw Error('what!');
			//startNum = first.idx - itemPerRow;
			//items.pop();
			//vPort.scrollTo(0, scrollOneThird - sub);
			//update = true;
		}
		console.log(vPort, { startNum });
		if (update) updateItems();
	}

	const handleReconnect = () => {
		// !TODO
		connected = true;
	};

	const handleCBoxClick = (
		e: MouseEvent & {
			currentTarget: EventTarget & HTMLInputElement;
		},
		item: IItem,
		row: IItem[]
	) => {
		item.active = !item.active;
	};
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="page-container">
	<div class="container">
		<header>
			<section aria-label="info">
				<p>{innerWidth}W - {innerHeight}H</p>
				<p>{widthPerRow}R - {widthPerCBox}C</p>
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

			<VirtualList bind:this={listRef} {items} let:item bind:start={sStart} bind:end={sEnd}>
				<div class="item-row">
					{#each item as i}
						{#key i.idx}
							<div class="inp-container">
								<input
									class="inp-item"
									type="checkbox"
									data-idx={i.idx}
									checked={i.active}
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
	}

	.zh {
		max-height: 0px;
		overflow: hidden;
	}
</style>
