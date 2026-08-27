import { json } from '@sveltejs/kit';

export const GET = ({ platform }) => {
	return json(
		{
			workerTime: Date.now(),
			edge: platform?.cf?.colo ?? 'local'
		},
		{
			headers: {
				'Cache-Control': 'no-store, no-cache, must-revalidate',
				'CDN-Cache-Control': 'no-store'
			}
		}
	);
};
