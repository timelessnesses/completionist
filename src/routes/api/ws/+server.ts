export const GET = async ({ request, platform, locals }) => {
	const response = (platform?.env as Env).GlobalWS.getByName('global_ws');
	if (!response) {
		return new Response('No global_ws found', { status: 404 });
	}
	const headers = new Headers(request.headers);
	headers.delete('x-completionist-user-id');
	if (locals.user?.user_id) {
		headers.set('x-completionist-user-id', locals.user.user_id);
	}
	// console.log('GlobalWS found, forwarding request...');
	const res = await response.fetch(new Request(request, { headers }));
	// console.log('res', res);
	return res;
};
