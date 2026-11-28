package com.oa.suite.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/**
 * App 自更新：系统 DownloadManager 下载新版 APK 到应用专属目录（无需存储权限），
 * 下载完成后校验 SHA-256、包名、版本号与签名，再交给系统安装器覆盖安装（应用数据保留）。
 * 状态存在 SharedPreferences 里，App 被杀后下载仍由系统继续，重新打开可接着安装。
 */
final class AppUpdater {

    static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String PREFS = "oa_update";
    private static final String KEY_ID = "download_id";
    private static final String KEY_CODE = "target_code";
    private static final String KEY_NAME = "target_name";
    private static final String KEY_SHA = "sha256";
    private static final String KEY_VERIFIED = "verified";
    private static final String KEY_ERROR = "error";
    private static final String DIR = "updates";

    private AppUpdater() {}

    static final class Progress {
        /** idle / downloading / paused / ready / failed */
        String state = "idle";
        long downloaded;
        long total;
        int targetCode;
        String targetName;
        String error;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static File dir(Context c) {
        return new File(c.getExternalFilesDir(null), DIR);
    }

    private static File apkFile(Context c, int code) {
        return new File(dir(c), "oa-mobile-" + code + ".apk");
    }

    static void start(Context c, String url, int code, String name, String sha256) {
        DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
        SharedPreferences p = prefs(c);
        long old = p.getLong(KEY_ID, -1);
        if (old >= 0) dm.remove(old);
        deleteFiles(c);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) req.addRequestHeader("Cookie", cookie);
        req.addRequestHeader("User-Agent", MainActivity.userAgentMark());
        req.setMimeType(APK_MIME);
        req.setTitle("协作平台 OA " + name);
        req.setDescription("正在下载新版本");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        req.setDestinationInExternalFilesDir(c, null, DIR + "/" + apkFile(c, code).getName());
        long id = dm.enqueue(req);
        p.edit()
            .putLong(KEY_ID, id)
            .putInt(KEY_CODE, code)
            .putString(KEY_NAME, name)
            .putString(KEY_SHA, sha256 == null ? "" : sha256.toLowerCase(Locale.ROOT))
            .putBoolean(KEY_VERIFIED, false)
            .remove(KEY_ERROR)
            .commit();
    }

    static Progress query(Context c) {
        Progress out = new Progress();
        SharedPreferences p = prefs(c);
        long id = p.getLong(KEY_ID, -1);
        if (id < 0) return out;
        out.targetCode = p.getInt(KEY_CODE, 0);
        out.targetName = p.getString(KEY_NAME, "");
        if (out.targetCode <= BuildConfig.VERSION_CODE) {
            // 已经装上目标版本（或更新的版本）：清理旧安装包
            clear(c);
            return new Progress();
        }
        String savedError = p.getString(KEY_ERROR, null);
        if (savedError != null) {
            out.state = "failed";
            out.error = savedError;
            return out;
        }
        DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
        try (Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (cur == null || !cur.moveToFirst()) {
                out.state = "failed";
                out.error = "下载任务已被取消";
                return out;
            }
            int status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            out.downloaded = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            out.total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int reason = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            switch (status) {
                case DownloadManager.STATUS_PENDING:
                case DownloadManager.STATUS_RUNNING:
                    out.state = "downloading";
                    break;
                case DownloadManager.STATUS_PAUSED:
                    out.state = "paused";
                    out.error = reason == DownloadManager.PAUSED_WAITING_FOR_NETWORK || reason == DownloadManager.PAUSED_WAITING_TO_RETRY
                        ? "网络中断，恢复后自动继续"
                        : "下载已暂停";
                    break;
                case DownloadManager.STATUS_FAILED:
                    out.state = "failed";
                    out.error = "下载失败（" + reason + "）";
                    break;
                case DownloadManager.STATUS_SUCCESSFUL:
                    if (!p.getBoolean(KEY_VERIFIED, false)) {
                        String err = verify(c, apkFile(c, out.targetCode), p.getString(KEY_SHA, ""));
                        if (err != null) {
                            p.edit().putString(KEY_ERROR, err).commit();
                            apkFile(c, out.targetCode).delete();
                            out.state = "failed";
                            out.error = err;
                            return out;
                        }
                        p.edit().putBoolean(KEY_VERIFIED, true).commit();
                    }
                    out.state = "ready";
                    break;
                default:
                    out.state = "downloading";
            }
        }
        return out;
    }

    /** 校验通过返回 null，否则返回给用户看的原因 */
    static String verify(Context c, File f, String sha256) {
        if (!f.isFile()) return "找不到下载的安装包";
        if (sha256 != null && !sha256.isEmpty()) {
            String actual = sha256Of(f);
            if (!sha256.equalsIgnoreCase(actual)) return "安装包校验失败（文件不完整或被篡改），请重新下载";
        }
        PackageManager pm = c.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(f.getAbsolutePath(), flags);
        if (archive == null) return "安装包已损坏";
        if (!c.getPackageName().equals(archive.packageName)) return "安装包不属于本应用";
        long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? archive.getLongVersionCode() : archive.versionCode;
        if (code <= BuildConfig.VERSION_CODE) return "安装包版本不高于当前版本";
        Boolean same = sameSigner(c, archive);
        if (Boolean.FALSE.equals(same)) {
            return "新版本的签名与已安装的 App 不一致，无法覆盖安装。请联系管理员（调试版需先卸载再安装正式版）";
        }
        return null;
    }

    /** 无法判断时返回 null（交给系统安装器最终把关） */
    @SuppressWarnings("deprecation")
    private static Boolean sameSigner(Context c, PackageInfo archive) {
        PackageManager pm = c.getPackageManager();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                SigningInfo si = archive.signingInfo;
                if (si == null) return null;
                Signature[] signers = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
                if (signers == null || signers.length == 0) return null;
                for (Signature s : signers) {
                    if (pm.hasSigningCertificate(c.getPackageName(), s.toByteArray(), PackageManager.CERT_INPUT_RAW_X509)) return true;
                }
                return false;
            }
            Signature[] a = archive.signatures;
            Signature[] b = pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
            if (a == null || b == null) return null;
            return Arrays.equals(a, b);
        } catch (Exception e) {
            return null;
        }
    }

    static String sha256Of(File f) {
        try (InputStream in = new FileInputStream(f)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** Android 8.0+ 安装 APK 需要用户为本应用打开「安装未知应用」 */
    static boolean canInstall(Context c) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || c.getPackageManager().canRequestPackageInstalls();
    }

    static Intent installIntent(Context c) {
        int code = prefs(c).getInt(KEY_CODE, 0);
        Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", apkFile(c, code));
        return new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static void clear(Context c) {
        SharedPreferences p = prefs(c);
        long id = p.getLong(KEY_ID, -1);
        if (id >= 0) {
            try {
                ((DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE)).remove(id);
            } catch (Exception ignored) {}
        }
        p.edit().clear().commit();
        deleteFiles(c);
    }

    private static void deleteFiles(Context c) {
        File[] files = dir(c).listFiles();
        if (files == null) return;
        for (File f : files) f.delete();
    }
}
