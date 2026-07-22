/**
 * Google Drive browser: navigate folders + select folder or file for RAG.
 */
import { Folder, FolderOpen, FileText, ChevronRight, CheckCircle2, Home } from 'lucide-react';
import type { DriveItem, DrivePathCrumb } from '../types';

type Props = {
  items: DriveItem[];
  path: DrivePathCrumb[];
  selectedId: string;
  selectedName?: string | null;
  selectedKind?: 'folder' | 'file' | null;
  busy?: boolean;
  error?: string | null;
  onNavigate: (folderId: string, folderName: string) => void;
  onNavigateCrumb: (index: number) => void;
  onSelect: (item: DriveItem) => void;
  emptyHint?: string;
};

function fileLabel(mime?: string): string {
  if (!mime) return '파일';
  if (mime.includes('document')) return 'Docs';
  if (mime.includes('spreadsheet')) return 'Sheets';
  if (mime.includes('presentation')) return 'Slides';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('image/')) return '이미지';
  if (mime.startsWith('text/')) return '텍스트';
  if (mime.includes('folder')) return '폴더';
  const short = mime.split('/').pop() || '파일';
  return short.length > 18 ? '파일' : short;
}

export default function DriveBrowser({
  items,
  path,
  selectedId,
  selectedName,
  selectedKind,
  busy,
  error,
  onNavigate,
  onNavigateCrumb,
  onSelect,
  emptyHint,
}: Props) {
  const folders = items.filter((i) => i.kind === 'folder' || i.mimeType?.includes('folder'));
  const files = items.filter((i) => i.kind !== 'folder' && !i.mimeType?.includes('folder'));

  return (
    <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low/40 overflow-hidden">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2.5 border-b border-outline-variant/20 bg-surface-container/50 overflow-x-auto text-sm">
        <button
          type="button"
          disabled={busy}
          onClick={() => onNavigateCrumb(-1)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest/60 shrink-0"
          title="내 Drive"
        >
          <Home className="w-3.5 h-3.5" />
          <span className="font-medium">내 Drive</span>
        </button>
        {path.map((crumb, i) => (
          <span key={crumb.id} className="inline-flex items-center gap-1 shrink-0">
            <ChevronRight className="w-3.5 h-3.5 text-outline" />
            <button
              type="button"
              disabled={busy}
              onClick={() => onNavigateCrumb(i)}
              className={
                i === path.length - 1
                  ? 'px-2 py-1 rounded-md text-on-surface font-medium bg-surface-container-highest/40'
                  : 'px-2 py-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest/60'
              }
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {selectedId && (
        <div className="px-4 py-2.5 border-b border-outline-variant/15 bg-google-blue/5 flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-solana-green shrink-0" />
          <span className="text-on-surface-variant">선택:</span>
          <span className="font-medium text-on-surface truncate">
            {selectedName || selectedId}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-outline border border-outline-variant/30 rounded px-1.5 py-0.5">
            {selectedKind === 'file' ? '파일' : '폴더'}
          </span>
        </div>
      )}

      <div className={`max-h-[320px] overflow-y-auto ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
        {error && (
          <p className="px-4 py-3 text-sm text-red-400 whitespace-pre-wrap">{error}</p>
        )}

        {!error && items.length === 0 && (
          <p className="px-4 py-8 text-sm text-on-surface-variant text-center">
            {emptyHint || '이 폴더가 비어 있습니다.'}
          </p>
        )}

        {folders.length > 0 && (
          <div className="px-2 pt-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-outline">
              폴더
            </p>
            <ul className="space-y-0.5">
              {folders.map((item) => {
                const selected = selectedId === item.id;
                return (
                  <li key={item.id}>
                    <div
                      className={
                        selected
                          ? 'flex items-stretch rounded-lg bg-google-blue/10 border border-google-blue/30'
                          : 'flex items-stretch rounded-lg border border-transparent hover:bg-surface-container-high/80'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left min-w-0"
                      >
                        {selected ? (
                          <FolderOpen className="w-5 h-5 text-google-blue shrink-0" />
                        ) : (
                          <Folder className="w-5 h-5 text-amber-400/90 shrink-0" />
                        )}
                        <span
                          className={
                            selected
                              ? 'font-medium text-on-surface truncate'
                              : 'text-on-surface truncate'
                          }
                        >
                          {item.name}
                        </span>
                        {selected && (
                          <CheckCircle2 className="w-4 h-4 text-solana-green ml-auto shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="폴더 열기"
                        onClick={() => onNavigate(item.id, item.name)}
                        className="px-3 flex items-center text-on-surface-variant hover:text-google-blue hover:bg-google-blue/10 rounded-r-lg border-l border-outline-variant/20"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {files.length > 0 && (
          <div className="px-2 pt-3 pb-2">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-outline">
              파일
            </p>
            <ul className="space-y-0.5">
              {files.map((item) => {
                const selected = selectedId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className={
                        selected
                          ? 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-google-blue/10 border border-google-blue/30 text-left'
                          : 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:bg-surface-container-high/80 text-left'
                      }
                    >
                      <FileText
                        className={
                          selected
                            ? 'w-5 h-5 text-google-blue shrink-0'
                            : 'w-5 h-5 text-on-surface-variant shrink-0'
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            selected
                              ? 'font-medium text-on-surface truncate'
                              : 'text-on-surface truncate'
                          }
                        >
                          {item.name}
                        </p>
                        <p className="text-[11px] text-outline">{fileLabel(item.mimeType)}</p>
                      </div>
                      {selected && <CheckCircle2 className="w-4 h-4 text-solana-green shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <p className="px-4 py-2 text-[11px] text-outline border-t border-outline-variant/15">
        폴더 행의 › 로 들어가고, 이름 클릭으로 지식 기반으로 선택합니다. 파일도 선택 가능합니다.
      </p>
    </div>
  );
}
