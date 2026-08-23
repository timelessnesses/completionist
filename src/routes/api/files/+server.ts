import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const PUT = async ({ request, platform, locals }) => { 
    const S3 = new S3Client({
        region: "auto",
        endpoint: `https://${(platform?.env as Env).CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: (platform?.env as Env).CLOUDFLARE_ACCESS_TOKEN,
            secretAccessKey: (platform?.env as Env).CLOUDFLARE_SECRET_ACCESS_TOKEN
        }
    });

    const uploadUrl = await getSignedUrl(S3, new PutObjectCommand({
        Bucket: "completionist-storage",
        
    }))
}