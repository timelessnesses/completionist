import { S3Client } from '@aws-sdk/client-s3'

export const PUT = async ({ request, platform, locals }) => { 
    const S3 = new S3Client({
        region: "auto",
        endpoint: `https://${(platform?.env as Env).CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: (platform?.env as Env).CLOUDFLARE_ACCESS_TOKEN,
            secretAccessKey: (platform?.env as Env).CLOUDFLARE_SECRET_ACCESS_TOKEN
        }
    });

    
}