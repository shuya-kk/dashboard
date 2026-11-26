/**
 * src/js/markdown-editor.tsx
 * CodeMirror 6 を用いた高機能Markdownエディタ + リアルタイムプレビュー（DOMPurifyによるHTMLサニタイズ必須適用）
 * + Frontmatter双方向編集パネル + 画像アップロード（GitHub Contents API経由）
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  Link as LinkIcon,
  Image as ImageIcon,
  List,
  ListOrdered,
  Quote,
  Code,
  Table,
  Minus,
  Upload,
  SlidersHorizontal,
  Eye,
  Columns
} from 'lucide-react';
import {
  renderSanitizedMarkdown,
  splitFrontmatterAndBody,
  updateFrontmatterField,
  extractDateOnlyForInput,
  formatTagsArrayString,
  parseTagsArrayToCommaString
} from './utils';
import type { FrontmatterFormat, RepositoryConfig } from '../types/domain';

interface MarkdownEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  repository: RepositoryConfig;
  onUploadImage?: (file: File) => Promise<{ markdownUrl: string; downloadUrl: string; path: string }>;
  isUploadingImage?: boolean;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  repository,
  onUploadImage,
  isUploadingImage = false
}) => {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [showFrontmatterPanel, setShowFrontmatterPanel] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split');
  const [newFmKey, setNewFmKey] = useState<string>('');
  const [newFmVal, setNewFmVal] = useState<string>('');

  // CodeMirror 6 インスタンスの初期化
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const docText = update.state.doc.toString();
        onChangeRef.current(docText);
      }
    });

    const startState = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        updateListener
      ]
    });

    const view = new EditorView({
      state: startState,
      parent: editorContainerRef.current
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部からの value 変更（ファイル切り替えやFrontmatterフォーム編集、テンプレート適用）をCodeMirrorに同期
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (currentText !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentText.length,
          insert: value
        }
      });
    }
  }, [value]);

  // 選択範囲またはカーソル位置にMarkdown記法を挿入するヘルパー
  const insertSyntax = (prefix: string, suffix = '', defaultPlaceholder = '') => {
    const view = editorViewRef.current;
    if (!view) return;

    const { state } = view;
    const range = state.selection.main;
    const selectedText = state.sliceDoc(range.from, range.to) || defaultPlaceholder;
    const replacement = `${prefix}${selectedText}${suffix}`;

    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: replacement
      },
      selection: {
        anchor: range.from + prefix.length,
        head: range.from + prefix.length + selectedText.length
      }
    });
    view.focus();
  };

  // 行頭に記法を挿入するヘルパー
  const insertLinePrefix = (linePrefix: string, placeholder: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    const { state } = view;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.from);
    const currentLineText = line.text;
    const nextText = currentLineText.trim().length > 0 ? `${linePrefix}${currentLineText}` : `${linePrefix}${placeholder}`;

    view.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: nextText
      },
      selection: {
        anchor: line.from + nextText.length
      }
    });
    view.focus();
  };

  // リアルタイムサニタイズ済みプレビューの生成
  const previewData = useMemo(() => {
    return renderSanitizedMarkdown(value);
  }, [value]);

  const parsedDoc = useMemo(() => {
    return splitFrontmatterAndBody(value);
  }, [value]);

  const handleFrontmatterFieldChange = (fieldKey: string, fieldVal: string) => {
    const fmt: FrontmatterFormat = repository.frontmatterFormat || 'yaml';
    const nextMarkdown = updateFrontmatterField(value, fieldKey, fieldVal, fmt);
    onChange(nextMarkdown);
  };

  const handleAddCustomFrontmatterField = (e: React.FormEvent) => {
    e.preventDefault();
    const k = newFmKey.trim();
    if (!k) return;
    handleFrontmatterFieldChange(k, newFmVal);
    setNewFmKey('');
    setNewFmVal('');
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadImage) return;
    try {
      const uploaded = await onUploadImage(file);
      insertSyntax(`![${file.name}](${uploaded.markdownUrl})`, '', '');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const standardFmKeys = ['title', 'pubDate', 'description', 'tags', 'visibility'];
  const allFmKeys = Array.from(new Set([...standardFmKeys, ...Object.keys(parsedDoc.fields)]));

  return (
    <div className="flex flex-col gap-3">
      {/* Frontmatter クイック編集パネル（あらゆるFrontmatter構造と双方向同期） */}
      {repository.frontmatterFormat !== 'none' && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>Frontmatter メタデータ編集（{repository.frontmatterFormat.toUpperCase()}）</span>
              <span className="text-slate-500 font-normal hidden sm:inline">
                ※エディタ内のFrontmatterとリアルタイム双方向同期します
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowFrontmatterPanel((prev) => !prev)}
              className="text-xs text-slate-600 hover:text-slate-900 px-2 py-0.5 border border-slate-300 rounded bg-white"
            >
              {showFrontmatterPanel ? '折りたたむ' : '展開する'}
            </button>
          </div>

          {showFrontmatterPanel && (
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {allFmKeys.map((key) => {
                  const currentVal = parsedDoc.fields[key] ?? '';
                  const isDateField =
                    key === 'pubDate' ||
                    key === 'date' ||
                    key === 'updatedDate' ||
                    key === 'publishedAt';

                  return (
                    <div key={key} className="flex flex-col">
                      <label className="text-xs font-medium text-slate-600 mb-1 font-mono">{key}</label>
                      {key === 'visibility' ? (
                        <select
                          value={currentVal || 'public'}
                          onChange={(e) => handleFrontmatterFieldChange('visibility', e.target.value)}
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900"
                        >
                          <option value="public">public（公開）</option>
                          <option value="private">private（非公開）</option>
                          <option value="unlisted">unlisted（限定公開）</option>
                          <option value="draft">draft（下書き）</option>
                        </select>
                      ) : key === 'draft' ? (
                        <select
                          value={currentVal === 'true' ? 'true' : 'false'}
                          onChange={(e) => handleFrontmatterFieldChange('draft', e.target.value)}
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900"
                        >
                          <option value="false">false（公開）</option>
                          <option value="true">true（下書き）</option>
                        </select>
                      ) : isDateField ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={extractDateOnlyForInput(currentVal)}
                            onChange={(e) => {
                              const picked = e.target.value;
                              if (!picked) {
                                handleFrontmatterFieldChange(key, '');
                                return;
                              }
                              // pubDate は YYYY-MM-DDT00:00:00Z 形式で反映
                              const nextIso =
                                key === 'pubDate' || currentVal.includes('T')
                                  ? `${picked}T00:00:00Z`
                                  : picked;
                              handleFrontmatterFieldChange(key, nextIso);
                            }}
                            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 font-mono flex-1 min-w-0"
                            title="カレンダーから日付を選択"
                          />
                          <input
                            type="text"
                            value={currentVal}
                            onChange={(e) => handleFrontmatterFieldChange(key, e.target.value)}
                            placeholder="2026-04-18T00:00:00Z"
                            className="px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-700 font-mono w-40 hidden xl:block"
                            title="ISO 8601 直接編集"
                          />
                        </div>
                      ) : key === 'tags' ? (
                        <input
                          type="text"
                          value={parseTagsArrayToCommaString(currentVal)}
                          placeholder="Cyano, サポート (カンマ区切り)"
                          onChange={(e) => {
                            const formattedArr = formatTagsArrayString(e.target.value);
                            handleFrontmatterFieldChange('tags', formattedArr);
                          }}
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-slate-600"
                        />
                      ) : (
                        <input
                          type="text"
                          value={currentVal}
                          placeholder={`${key} の値`}
                          onChange={(e) => handleFrontmatterFieldChange(key, e.target.value)}
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-slate-600"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 任意キーの追加 */}
              <form onSubmit={handleAddCustomFrontmatterField} className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <span className="text-xs text-slate-500">カスタム属性追加:</span>
                <input
                  type="text"
                  value={newFmKey}
                  onChange={(e) => setNewFmKey(e.target.value)}
                  placeholder="キー名 (例: category)"
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white w-36 font-mono"
                />
                <input
                  type="text"
                  value={newFmVal}
                  onChange={(e) => setNewFmVal(e.target.value)}
                  placeholder="値 (例: tech)"
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white w-44"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 text-xs font-medium bg-slate-800 text-white rounded hover:bg-slate-700"
                >
                  Frontmatterに反映
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Markdown ツールバー */}
      <div className="bg-white border border-slate-200 rounded-md p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            title="見出し1 (# )"
            onClick={() => insertLinePrefix('# ', '見出し1')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Heading1 className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="見出し2 (## )"
            onClick={() => insertLinePrefix('## ', '見出し2')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Heading2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="見出し3 (### )"
            onClick={() => insertLinePrefix('### ', '見出し3')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Heading3 className="w-4 h-4" />
          </button>

          <span className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            title="太字 (**text**)"
            onClick={() => insertSyntax('**', '**', '太字テキスト')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="斜体 (*text*)"
            onClick={() => insertSyntax('*', '*', '斜体テキスト')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Italic className="w-4 h-4" />
          </button>

          <span className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            title="リンク ([テキスト](https://...))"
            onClick={() => insertSyntax('[', '](https://example.com)', 'リンクテキスト')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="画像記法 (![alt](/images/example.png))"
            onClick={() => insertSyntax('![', '](/images/sample.png)', '画像の説明')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          {onUploadImage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif"
                onChange={handleImageFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={isUploadingImage}
                title={`画像をリポジトリ (${repository.imagesDir || 'public/images'}) にアップロードして挿入`}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isUploadingImage ? '画像アップロード中...' : '画像アップロード'}</span>
              </button>
            </>
          )}

          <span className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            title="箇条書きリスト (- )"
            onClick={() => insertLinePrefix('- ', 'リスト項目')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="番号付きリスト (1. )"
            onClick={() => insertLinePrefix('1. ', '番号付き項目')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="引用 (> )"
            onClick={() => insertLinePrefix('> ', '引用テキスト')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Quote className="w-4 h-4" />
          </button>

          <span className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            title="コードブロック (```)"
            onClick={() => insertSyntax('\n```ts\n', '\n```\n', '// コードを入力')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="テーブル挿入"
            onClick={() =>
              insertSyntax(
                '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| ',
                ' | データ2 | データ3 |\n',
                'データ1'
              )
            }
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Table className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="水平線 (---)"
            onClick={() => insertSyntax('\n\n---\n\n', '', '')}
            className="p-1.5 text-slate-700 hover:bg-slate-100 rounded border border-transparent hover:border-slate-200"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* 表示モード切替（分割 / エディタのみ / プレビューのみ） */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1 px-2 py-1 rounded ${
              viewMode === 'split' ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'text-slate-600'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>分割表示</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit')}
            className={`px-2 py-1 rounded ${
              viewMode === 'edit' ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'text-slate-600'
            }`}
          >
            編集のみ
          </button>
          <button
            type="button"
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1 px-2 py-1 rounded ${
              viewMode === 'preview' ? 'bg-white text-slate-900 font-semibold shadow-2xs' : 'text-slate-600'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>プレビューのみ</span>
          </button>
        </div>
      </div>

      {/* エディタ & リアルタイムサニタイズ済みプレビュー並列領域 */}
      <div
        className={
          viewMode === 'split'
            ? 'editor-split-pane'
            : 'grid grid-cols-1 min-h-[600px]'
        }
      >
        {/* 左ペイン：CodeMirror 6 Markdown直接編集 */}
        <div
          className={`bg-white border border-slate-300 rounded-md flex flex-col overflow-hidden ${
            viewMode === 'preview' ? 'hidden' : ''
          }`}
        >
          <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Markdown ソース編集 (CodeMirror 6)</span>
            <span className="font-mono">{value.length.toLocaleString()} 文字</span>
          </div>
          <div ref={editorContainerRef} className="cm-editor-container flex-1 overflow-auto" />
        </div>

        {/* 右ペイン：DOMPurify HTMLサニタイズ適用リアルタイムプレビュー */}
        <div
          className={`bg-white border border-slate-300 rounded-md flex flex-col overflow-hidden ${
            viewMode === 'edit' ? 'hidden' : ''
          }`}
        >
          <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">リアルタイムプレビュー（HTMLサニタイズ適用済み）</span>
            <span className="text-emerald-700 font-medium">XSS保護有効</span>
          </div>

          <div className="p-5 overflow-auto flex-1 max-h-[720px]">
            {/* Frontmatter メタ情報のプレビューヘッダー表示 */}
            {Object.keys(previewData.frontmatter).length > 0 && (
              <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
                <div className="font-semibold text-slate-700 mb-1">Frontmatter 属性</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {Object.entries(previewData.frontmatter).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-1.5">
                      <span className="font-mono font-semibold text-slate-600">{k}:</span>
                      <span className="text-slate-900 break-all">{v || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* サニタイズ済みHTML描画 */}
            <div
              className="markdown-preview-body"
              dangerouslySetInnerHTML={{ __html: previewData.sanitizedHtml }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
