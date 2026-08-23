import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { json, error as svelteError } from '@sveltejs/kit';

type FilePresignBody = {
	key?: string;
	contentType?: string;
	expiresIn?: number;
};

type R2Env = Env & {
	CLOUDFLARE_ACCOUNT_ID: string;
	CLOUDFLARE_ACCESS_TOKEN: string;
	CLOUDFLARE_SECRET_ACCESS_TOKEN: string;
};

const BUCKET = 'completionist-storage';

export const GET = async ({ url, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	const key = url.searchParams.get('key')?.trim();
	if (!key) {
		throw svelteError(400, 'key is required');
	}

	const { client, env } = createClient(platform?.env as R2Env);
	const downloadUrl = await getSignedUrl(
		client,
		new GetObjectCommand({
			Bucket: BUCKET,
			Key: key
		}),
		{ expiresIn: 60 * 15 }
	);

	return json(
		{
			key,
			url: downloadUrl,
			method: 'GET',
			bucket: BUCKET,
			accountId: env.CLOUDFLARE_ACCOUNT_ID
		},
		{ status: 200 }
	);
};

export const PUT = async ({ request, platform, locals }) => {
	if (!locals.user) {
		throw svelteError(401, 'Unauthorized');
	}

	let body: FilePresignBody = {};
	try {
		body = await request.json();
	} catch {
		// Allow the caller to fall back to query-string input.
	}

	const key = body.key?.trim() ?? new URL(request.url).searchParams.get('key')?.trim();
	if (!key) {
		throw svelteError(400, 'key is required');
	}

	const { client, env } = createClient(platform?.env as R2Env);
	const uploadUrl = await getSignedUrl(
		client,
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: key,
			ContentType: body.contentType
		}),
		{ expiresIn: body.expiresIn ?? 60 * 15 }
	);

	return json(
		{
			key,
			url: uploadUrl,
			method: 'PUT',
			bucket: BUCKET,
			accountId: env.CLOUDFLARE_ACCOUNT_ID
		},
		{ status: 200 }
	);
};

function createClient(env: R2Env) {
	const client = new S3Client({
		region: 'auto',
		endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: env.CLOUDFLARE_ACCESS_TOKEN,
			secretAccessKey: env.CLOUDFLARE_SECRET_ACCESS_TOKEN
		}
	});

	return { client, env };
}
