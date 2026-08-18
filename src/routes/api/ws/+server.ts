export const GET = async ({ request, platform }) => { 
    const response = platform?.env.GlobalWS.getByName('global_ws');
    if (!response) {
        return new Response('No global_ws found', { status: 404 });
    }
    console.log('GlobalWS found, forwarding request...');
    const res = await response.fetch(request);
    console.log('res', res);
    return res;
};