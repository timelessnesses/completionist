import { user } from './server/db/schema';

export type ShouldRefetch = {
	type: 'shouldRefetch';
};

export type NewMessage = {
	type: 'newMessage';
	user_id: string;
	message: string;
};

export type UserListUpdate = {
	type: 'userListUpdate';
	users: (typeof user.$inferSelect)[];
};

export type WebSocketMessage = ShouldRefetch | NewMessage | UserListUpdate;
