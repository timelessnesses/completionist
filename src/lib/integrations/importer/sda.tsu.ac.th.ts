import { parseSetCookie } from "set-cookie-parser";

class SDATSUImporter extends Importer {
    cache: KVNamespace;
    connector: Fetcher;
    username: string;
    password: string;
    constructor(cache: KVNamespace, connector: Fetcher, username: string, password: string) {
        super();
        this.cache = cache;
        this.connector = connector;
        this.username = username;
        this.password = password;
    }

    // returns a JSESSIONID cookie string if login is successful, otherwise throws an error
    async login(): Promise<JSESSIONID> { 
        const JSESSIONID = await this.cache.get<JSESSIONID>('JSESSIONID');
        if (JSESSIONID) {
            const isValid = await this.verifyLogin(JSESSIONID);
            if (isValid) {
                return JSESSIONID;
            }
        }
        const initialJSESSIONID = parseSetCookie((await this.connector.fetch(LOGIN_PAGE)).headers.get('set-cookie') || '')?.find(cookie => cookie.name === 'JSESSIONID')?.value;
        if (!initialJSESSIONID) {
            throw new Error("Failed to get initial JSESSIONID from login page.");
        }
        const queries = new URLSearchParams();
        queries.append("action", LOGIN_FORM_ACTION);
        queries.append("username", this.username);
        queries.append("password", this.password);
        const response = await this.connector.fetch(LOGIN_PAGE, {
            method: 'POST',
            body: queries,
            headers: {
                'Cookie': `JSESSIONID=${initialJSESSIONID}`,
            }
        });

        if (!await this.verifyLogin(initialJSESSIONID as JSESSIONID)) {
            throw new Error("Login failed. Please check your username and password.");
        }
        await this.cache.put('JSESSIONID', initialJSESSIONID, { expirationTtl: 60 * 60 * 24 * 7 }); // cache for 7 days
        return initialJSESSIONID as JSESSIONID;
    }

    async verifyLogin(jsessionid: JSESSIONID): Promise<boolean> { 
        const response = await this.connector.fetch(ACTIVITY_LIST_PAGE, {
            method: 'GET',
            headers: {
                'Cookie': `JSESSIONID=${jsessionid}`,
            }
        });
        return !(response.status === 302 && response.headers.get('Location')?.includes(LOGIN_PAGE));
    }

    async fetchData(): Promise<ActivitiesResponse> { 
        const jsessionid = await this.login();
        const response = await this.connector.fetch(ACTIVITY_LIST_PAGE, {
            method: 'GET',
            headers: {
                'Cookie': `JSESSIONID=${jsessionid}`,
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch activity list. Status: ${response.status}`);
        }
        const html = await response.text();
        return (await Promise.all(
            this.getActivityListByHtml(html).map(
                async (activityId) => {
                const activityDetailUrl = new URL(ACTIVITY_DETAIL);
                activityDetailUrl.searchParams.append('aesID', activityId.id.toString());
                const activityDetailResponse = await this.connector.fetch(activityDetailUrl, {
                    method: 'GET',
                    headers: {
                        Cookie: `JSESSIONID=${jsessionid}`,
                    },
                });
                const detail = (await activityDetailResponse.json()) as ActivitiesResponse;
                return detail;
            })
        )).flat();
    }

    getActivityListByHtml(html: string) {
        // console.log('Parsing activity list from HTML', html);
        const activityList: { id: number }[] = [];
        const regex = /data-bs-aesID\s*=\s*["'](\d+)["']/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            activityList.push({ id: parseInt(match[1]) });
        }
        return activityList;
    }
}

type JSESSIONID = string & { __brand: "JSESSIONID" };

const LOGIN_FORM_ACTION = "เข้าสู่ระบบ"
const LOGIN_PAGE = 'https://sda.tsu.ac.th/public/login.jsp';
const ACTIVITY_LIST_PAGE = 'https://sda.tsu.ac.th/student/apply.jsp';
const APPLY_ACTIVITY_PAGE = 'https://sda.tsu.ac.th/student/services/applyActivity.jsp';
const MAIN_HOST = 'https://sda.tsu.ac.th';
const ACTIVITY_DETAIL = 'https://sda.tsu.ac.th/student/services/activity.jsp';

export interface Activity {
	activity_id: number;
	id: number;

	activity: string;
	description: string;

	organization: string;
	unit_name: string;
	sub_unit_name: string;
	activity_type_name: string;

	act_place: string;
	act_date: string;

	start_date: string;
	end_date: string;

	can_apply: 'true' | 'false';

	group_number: string;

	total: number;
	num_apply: number;

	upload_file: string;
	banner_path: string;
}

export type ActivitiesResponse = Activity[];

export type ApplyResponse = {
	id: number;
	result_text: string;
	result: 'true' | 'false';
};