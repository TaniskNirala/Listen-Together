import { Crown, Disc3, Shield, UserMinus } from 'lucide-react';
import type { ControlMode, RoomListener } from '../shared/types';

interface ListenersPanelProps {
  listeners: RoomListener[];
  currentUserId: number;
  controlMode: ControlMode;
  canManage: boolean;
  onChangeControlMode: (mode: ControlMode) => void;
  onChangeMemberRole: (targetUserId: number, role: 'dj' | 'listener') => void;
  onKickMember: (targetUserId: number) => void;
}

export function ListenersPanel({
  listeners,
  currentUserId,
  controlMode,
  canManage,
  onChangeControlMode,
  onChangeMemberRole,
  onKickMember,
}: ListenersPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Room Control Mode Setting (visible to all, editable by host/admin) */}
      <div className="border-b border-slate-200 px-4 py-3 dark:border-[#1E2636]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Playback controls
          </span>
          {!canManage && (
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
              {controlMode === 'dj_only' ? 'Host & DJs only' : 'Everyone'}
            </span>
          )}
        </div>

        {canManage && (
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#0B0E14]">
            <button
              type="button"
              onClick={() => onChangeControlMode('everyone')}
              className={`h-9 rounded-lg text-xs font-medium transition-colors ${
                controlMode === 'everyone'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Everyone
            </button>
            <button
              type="button"
              onClick={() => onChangeControlMode('dj_only')}
              className={`h-9 rounded-lg text-xs font-medium transition-colors ${
                controlMode === 'dj_only'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-[#1E2636] dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Host & DJs only
            </button>
          </div>
        )}
      </div>

      {/* Online Listeners List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {listeners.length} {listeners.length === 1 ? 'listener' : 'listeners'} in room
        </p>

        <ul className="divide-y divide-slate-200/70 dark:divide-[#1E2636]">
          {listeners.map((member) => {
            const isSelf = member.userId === currentUserId;
            const roleLabel =
              member.role === 'host' ? 'Host' : member.role === 'dj' ? 'DJ' : 'Listener';
            const canModerate = canManage && !isSelf && member.role !== 'host';

            return (
              <li key={member.userId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        member.inChat
                          ? 'bg-emerald-500'
                          : member.tabActive
                          ? 'bg-emerald-400/75'
                          : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                      title={
                        member.inChat
                          ? 'Active in chat (tab open on screen)'
                          : member.tabActive
                          ? 'Tab open on screen'
                          : 'Tab in background'
                      }
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {member.username}
                    </span>
                    {isSelf && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">(you)</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {member.role === 'host' ? (
                      <Crown className="h-3 w-3 text-orange-500" aria-hidden="true" />
                    ) : member.role === 'dj' ? (
                      <Disc3 className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                    ) : null}
                    <span>{roleLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        member.inChat
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : member.tabActive
                          ? 'text-slate-600 dark:text-slate-300'
                          : 'text-slate-400 dark:text-slate-500'
                      }
                    >
                      {member.inChat ? 'In chat' : member.tabActive ? 'On screen' : 'Background'}
                    </span>
                  </div>
                </div>

                {canModerate && (
                  <div className="flex shrink-0 items-center gap-1">
                    {member.role === 'listener' ? (
                      <button
                        type="button"
                        onClick={() => onChangeMemberRole(member.userId, 'dj')}
                        aria-label={`Promote ${member.username} to DJ`}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-[#242C3D] dark:text-slate-200 dark:hover:bg-[#1E2636]"
                      >
                        <Shield className="h-3 w-3" aria-hidden="true" />
                        Make DJ
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onChangeMemberRole(member.userId, 'listener')}
                        aria-label={`Demote ${member.username} to listener`}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-[#242C3D] dark:text-slate-300 dark:hover:bg-[#1E2636]"
                      >
                        Demote
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onKickMember(member.userId)}
                      aria-label={`Kick ${member.username}`}
                      title="Kick from room"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
