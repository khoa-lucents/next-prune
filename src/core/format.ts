const FORMAT_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

const toValidDate = (value: Date | number | null | undefined): Date | null => {
	if (value === null || value === undefined) return null;

	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;

	return date;
};

export const human = (bytes: number | null | undefined): string => {
	if (bytes === 0) return '0 B';
	if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
		return '-';
	}

	const unitIndex = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		FORMAT_UNITS.length - 1,
	);
	const value = bytes / 1024 ** unitIndex;
	const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;

	return `${value.toFixed(decimals)} ${FORMAT_UNITS[unitIndex]}`;
};

export const timeAgo = (
	value: Date | number | null | undefined,
	now = Date.now(),
): string => {
	const date = toValidDate(value);
	if (!date) return '';

	const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
	let interval = seconds / 31_536_000;
	if (interval >= 1) return `${Math.floor(interval)}y ago`;

	interval = seconds / 2_592_000;
	if (interval >= 1) return `${Math.floor(interval)}mo ago`;

	interval = seconds / 86_400;
	if (interval >= 1) return `${Math.floor(interval)}d ago`;

	interval = seconds / 3600;
	if (interval >= 1) return `${Math.floor(interval)}h ago`;

	interval = seconds / 60;
	if (interval >= 1) return `${Math.floor(interval)}m ago`;

	return `${seconds}s ago`;
};
