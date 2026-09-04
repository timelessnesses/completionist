import type { buildMonthGrid } from './date';
import { isProjectLike } from '../tasks/project';
import type { RichTask } from '../tasks/types';

export type MonthCell = ReturnType<typeof buildMonthGrid>[number];

export type MonthBar = {
	event: RichTask;
	startColumn: number;
	span: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
};

export type MonthWeekLayout = {
	key: string;
	cells: MonthCell[];
	bars: MonthBar[];
	laneCount: number;
};

function dayStamp(value: Date | number): number {
	const date = new Date(value);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function layoutWeek(cells: MonthCell[], events: RichTask[]): MonthWeekLayout {
	const firstDay = dayStamp(cells[0].date);
	const lastDay = dayStamp(cells[cells.length - 1].date);
	const bars: MonthBar[] = events
		.flatMap((event) => {
			const eventStart = dayStamp(event.start_at);
			const eventEnd = Math.max(eventStart, dayStamp(event.end_at));
			if (eventEnd < firstDay || eventStart > lastDay) return [];

			const visibleStart = Math.max(eventStart, firstDay);
			const visibleEnd = Math.min(eventEnd, lastDay);
			const startColumn = cells.findIndex((cell) => dayStamp(cell.date) === visibleStart) + 1;
			const endColumn = cells.findIndex((cell) => dayStamp(cell.date) === visibleEnd) + 1;
			return [
				{
					event,
					startColumn,
					span: endColumn - startColumn + 1,
					lane: 0,
					continuesBefore: eventStart < firstDay,
					continuesAfter: eventEnd > lastDay
				}
			];
		})
		.sort((a, b) => {
			const projectOrder = Number(isProjectLike(b.event)) - Number(isProjectLike(a.event));
			return projectOrder || b.span - a.span || a.startColumn - b.startColumn;
		});

	const laneEnds: number[] = [];
	for (const bar of bars) {
		const endColumn = bar.startColumn + bar.span - 1;
		let lane = laneEnds.findIndex((occupiedThrough) => occupiedThrough < bar.startColumn);
		if (lane < 0) lane = laneEnds.length;
		bar.lane = lane;
		laneEnds[lane] = endColumn;
	}

	return {
		key: cells[0].key,
		cells,
		bars,
		laneCount: Math.max(1, laneEnds.length)
	};
}

export function layoutMonthWeeks(cells: MonthCell[], events: RichTask[]): MonthWeekLayout[] {
	const weeks: MonthWeekLayout[] = [];
	for (let index = 0; index < cells.length; index += 7) {
		weeks.push(layoutWeek(cells.slice(index, index + 7), events));
	}
	return weeks;
}
