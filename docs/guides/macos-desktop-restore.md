# Restoring the Local ~/Desktop Directory on macOS After iCloud Sync

## Your macOS Version

Darwin 24.6.0 corresponds to **macOS Sequoia 15.6** (build 24G84, released July 29, 2025).

In macOS 15 Sequoia, Apple renamed "Apple ID" to **"Apple Account"** throughout System Settings.

## Background

When "Desktop & Documents Folders" is enabled in iCloud Drive settings, macOS
redirects `~/Desktop` and `~/Documents` to iCloud Drive. Files are stored in the
cloud and may appear locally only as stubs (cloud-only references). If iCloud
storage is full or network is slow, files can become inaccessible.

## Step 1: Disable Desktop & Documents Folders Sync

1. Open **System Settings** (Apple menu > System Settings).
2. Click your **name** at the top of the sidebar (labeled "Apple Account").
3. Click **iCloud**.
4. Under **"Saved to iCloud"**, click **Drive**.
5. Toggle **off** "Desktop & Documents Folders".
6. Click **Done**.

A confirmation dialog will appear stating:

> "Items will be removed from the Desktop & Documents folder on this Mac and
> will remain available in iCloud Drive."

Click **Turn Off** to confirm.

## Step 2: Understand Where Files Went

After turning off the toggle:

- A **new, empty** `~/Desktop` and `~/Documents` folder is created locally in your home directory.
- Your **existing files remain in iCloud Drive** under folders named "Desktop" and "Documents".
- Files are NOT deleted. They simply lose the special "synced" status.

## Step 3: Move Files Back to Local Desktop

### Option A: Via Finder (Recommended)

1. Open **Finder**.
2. In the menu bar, click **Go > iCloud Drive** (or press Shift+Cmd+I).
3. Inside iCloud Drive, you will see a **Desktop** folder (and a **Documents** folder).
4. Open the **Desktop** folder in iCloud Drive.
5. Select all files: **Cmd+A**.
6. **Drag** them to your local Desktop (visible in the Finder sidebar, or navigate to your home folder and open Desktop).

Repeat for the Documents folder if needed.

### Option B: Move and Delete from iCloud Simultaneously

Hold **Cmd** while dragging files from the iCloud Drive Desktop folder to your
local Desktop. This performs a **move** (copy to new location, delete from old
location) rather than a copy, freeing up iCloud storage immediately.

### Option C: Via Terminal

```bash
# List what is in the iCloud Drive Desktop folder
ls ~/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop/

# Copy everything back to local Desktop
cp -R ~/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop/* ~/Desktop/

# Once verified, optionally remove from iCloud Drive
# rm -rf ~/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop/*
```

## Step 4: Handle Cloud-Only Files

Some files may show a **cloud icon** (download arrow) in Finder, meaning they
exist only in iCloud and have no local copy. Before you can move them:

1. In Finder, right-click the file and select **"Download Now"**.
2. Alternatively, double-click the file to trigger a download.
3. To download everything at once: select all files (Cmd+A), right-click, and choose **"Download Now"**.

Wait for all downloads to complete before moving files. Check that files have
a solid icon (no cloud symbol) before proceeding.

## Step 5: Verify Restoration

After moving files back:

```bash
# Confirm files are on local disk
ls -la ~/Desktop/

# Confirm they are real files, not iCloud stubs
# Files with "com.apple.icloud" extended attributes are still cloud-only
xattr -l ~/Desktop/* 2>/dev/null | grep -c "com.apple.icloud"
# Should return 0 if all files are fully local
```

## Caveats

1. **Download time**: If you had many files or large files in iCloud, downloading
   them all back to local storage can take significant time depending on your
   internet connection. Do not interrupt this process.

2. **Storage requirements**: You need enough free local disk space to hold all the
   files that were previously offloaded to iCloud. Check available space with
   Apple menu > About This Mac > More Info > Storage.

3. **Multiple Macs**: If you had Desktop & Documents sync enabled on multiple
   Macs, you may see multiple Desktop folders in iCloud Drive (e.g.,
   "Desktop - MacBook Pro"). Each Mac's files are in its own folder.

4. **iCloud Drive Archive**: If you turn off iCloud Drive entirely (not just the
   Desktop & Documents toggle), macOS creates an "iCloud Drive (Archive)" folder
   in your home directory containing a local copy of everything. This is a
   separate, more drastic action.

5. **Optimize Mac Storage**: If "Optimize Mac Storage" was enabled (System
   Settings > Apple Account > iCloud > Drive), older files may have been
   evicted from local storage entirely. These must be downloaded from iCloud
   before they can be moved to local Desktop.

6. **Do not sign out of iCloud** until all files are downloaded and verified
   locally. Signing out may remove access to cloud-only files.

7. **Time Machine**: If you had Time Machine backups from before enabling iCloud
   sync, your original local Desktop files may also be recoverable from there.

## Quick Reference: Key Paths

| Location | Path |
|---|---|
| Local Desktop | `~/Desktop/` |
| Local Documents | `~/Documents/` |
| iCloud Drive Desktop | `~/Library/Mobile Documents/com~apple~CloudDocs/Desktop/` |
| iCloud Drive Documents | `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/` |
| iCloud Drive Archive (if created) | `~/iCloud Drive (Archive)/` |

## Sources

- [Add your Desktop and Documents files to iCloud Drive - Apple Support](https://support.apple.com/en-us/109344)
- [How to find your Documents and Desktop folder contents after disabling iCloud sync - Macworld](https://www.macworld.com/article/232792/how-to-find-your-documents-and-desktop-folder-contents-after-disabling-icloud-sync.html)
- [What Happens When You Turn Off Desktop & Documents Folders for iCloud Drive - MacMost](https://macmost.com/what-happens-when-you-turn-off-desktop-documents-folders-for-icloud-drive.html)
- [How to stop desktop files from syncing to iCloud on macOS - XDA](https://www.xda-developers.com/how-stop-desktop-syncing-icloud-macos/)
- [Apple ID Renamed to Apple Account in Latest Operating System Releases](https://austinmacworks.com/apple-id-renamed-to-apple-account-in-latest-operating-system-releases/)
