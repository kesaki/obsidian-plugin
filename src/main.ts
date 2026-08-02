import { Notice, Plugin, TFile } from 'obsidian';
import { exec } from 'child_process';

const FM = {
	START_DATE: "作業開始日時",
	KANRI_NO: "管理番号",
	SALON_NAME: "店名",
    WORK_TYPE: "業務種別",
	RESERVED: "確定",
} as const;

type WorkConfig = {
    regionMap: Record<string, string>;
    initialContents: Record<string, string>;
};

const DB_WORK_CONFIG: WorkConfig = {
    regionMap: {
        DB作成: "DB",
        CSV作成: "CSV",
        E設定: "E",
    },

    initialContents: {
        DB: `
- [ ] DB作成
- [ ] ライセンス発行
`,
        CSV: `
- [ ] CSV作成
- [ ] CSVアップロード
`,
        E: `
- [ ] Eリザーブ登録
`
    }
};

type ArchivedContents = Record<string, string>;

function createDatePrefix(donyuDate: string): string {
    const date = new Date(donyuDate);

    if (isNaN(date.getTime())) {
        return `${donyuDate}_`
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");

    return `${year}年${month}月${day}日_${hour}時${minute}分_`;
}

function clearRegion(text: string, regionName: string): string {
    const regex = new RegExp(
        `(<!-- REGION_${regionName}_START -->)[\\s\\S]*?(<!-- REGION_${regionName}_END -->)`,
        "g"
    );
    return text.replace(regex, "$1\n\n$2");
}

function getRegionContent(text: string, regionName: string): string {
    const regex = new RegExp(
        `<!--\\s*REGION_${regionName}_START\\s*-->([\\s\\S]*?)<!--\\s*REGION_${regionName}_END\\s*-->`
    );

    const match = text.match(regex);

    if (!match) {
        return "";
    }

    return match[1] ?? "";
}

function appendRegionContent(
    text: string,
    regionName: string,
    addContent: string
): string {
    const regex = new RegExp(
        `(<!-- REGION_${regionName}_START -->)([\\s\\S]*?)(<!-- REGION_${regionName}_END -->)`,
        "g"
    );

    return text.replace(
        regex,
        `$1$2${addContent}\n$3`
    );
}

export default class MyPlugin extends Plugin {
    private workConfig = DB_WORK_CONFIG;
    private previousWorkTypes = new Map<TFile, string[]>();
    private isUpdating = new Set<TFile>(); // 二重発火防止フラグ
    private isRenaming = new Set<TFile>();
    private archivedContentsMap = new Map<TFile, ArchivedContents>();
    private getArchivedContents(file: TFile): ArchivedContents {
        let archivedContents  = this.archivedContentsMap.get(file);

        if (!archivedContents) {
            archivedContents = {
                ...this.workConfig.initialContents
            };

            this.archivedContentsMap.set(file, archivedContents);
        }

        return archivedContents;
    }

    async onload() {

        this.registerEvent( // ファイルがアクティベートされた時の業務種別プロパティを取る
            this.app.workspace.on("file-open", async (file) => {
                if (!file) {
                    return;
                }

                const cache = this.app.metadataCache.getFileCache(file);

                const workType: string[] =
                    cache?.frontmatter?.[FM.WORK_TYPE] ?? [];

                this.previousWorkTypes.set(file, [...workType]);

                console.log("開いたファイル登録:", file.path);
                console.log("元の業務種別：", this.previousWorkTypes.get(file));
            })
        );

        // ===== メタデータ変更イベント =====
        this.registerEvent(

            // フロントマターに変更が加わったとき、コールバックを実行する
            // コールバックにはmetadataCacheのfile,data,cacheが渡される
            this.app.metadataCache.on(
                "changed",
                async (file, data, cache) => {

                    if (this.isRenaming.has(file)) {
                        return;
                    }

                    if (this.isUpdating.has(file)) {
                        return;
                    }

                    const workType: string[] = cache.frontmatter?.[FM.WORK_TYPE] ?? [];
                    const oldWorkType = this.previousWorkTypes.get(file);
                    if (oldWorkType === undefined) {
                        this.previousWorkTypes.set(file, [...workType]);
                        return;
                    }

                    const removedWorkTypes = oldWorkType.filter(
                        (item) => !workType.includes(item)
                    );
                    const addedWorkTypes = workType.filter(
                        (item) => !oldWorkType.includes(item)
                    );

                    let content = await this.app.vault.read(file);

                    const archivedContents = this.getArchivedContents(file);


                    for (const item of removedWorkTypes) {
                        const regionName = this.workConfig.regionMap[item];

                        if (!regionName) {
                            continue;
                        }

                        const regionContent = getRegionContent(content, regionName);

                        if (regionContent) {
                            archivedContents[regionName] = regionContent;
                        }

                        content = clearRegion(content, regionName);
                    }

                    for (const item of addedWorkTypes) {
                        const regionName = this.workConfig.regionMap[item];

                        if (!regionName) {
                            continue;
                        }

                        const addContent = archivedContents[regionName] ?? "";

                        content = appendRegionContent(
                            content,
                            regionName,
                            addContent
                        );
                    }

                    // コンテンツ書き換え処理
                    if (removedWorkTypes.length > 0 || addedWorkTypes.length > 0) {
                        this.isUpdating.add(file);

                        await this.app.vault.modify(file, content);

                        this.isUpdating.delete(file);
                    }

                    // ここで今回の状態を保存, 参照渡しは危険なのでworkTypeのコピーを代入している
                    this.previousWorkTypes.set(file, [...workType]);

                    // ここからファイル名変更処理
                    const donyuDate  = cache.frontmatter?.[FM.START_DATE];
                    const kanriNo    = cache.frontmatter?.[FM.KANRI_NO];
                    const salonName  = cache.frontmatter?.[FM.SALON_NAME];
                    const reserved   = cache.frontmatter?.[FM.RESERVED];

                    if (!donyuDate || !kanriNo || !salonName) {
                        return;
                    }

                    const datePrefix = createDatePrefix(donyuDate);

                    const statusPrefix = reserved ? "" : "【調整中】_";

                    const newName = `${datePrefix}${statusPrefix}${kanriNo}_${salonName}.md`;

                    if (file.name === newName) {
                        return;
                    }
                    if (!file.parent) {
                        return;
                    }

                    const newPath = `${file.parent.path}/${newName}`;

                    this.isRenaming.add(file);
                    await this.app.vault.rename(file, newPath);
                    this.isRenaming.delete(file);
                }
            )
        );

        // ===== リボンアイコン：完了報告 =====
        this.addRibbonIcon(
            "play",
            "完了報告",
            () => {
                const file = this.app.workspace.getActiveFile();

                if (!file) {
                    new Notice('ファイルを開いてください');
                    return;
                }

                const cache = this.app.metadataCache.getFileCache(file);
                const  kanriNo = cache?.frontmatter?.[FM.KANRI_NO];

                if (! kanriNo) {
                    new Notice('管理番号がありません');
                    return;
                }

                exec(
                    `"C:\\Users\\test\\.venv\\Scripts\\python.exe" ` +
                    `"C:\\Users\\test.py" ` +
                    `"${ kanriNo}"`,
                    (error, stdout, stderr) => {
                        if (stdout) console.log(stdout);
                        if (stderr) console.error(stderr);
                        if (error) console.error(error);
                    }
                );
            }
        );
    }

    onunload() {}
}
