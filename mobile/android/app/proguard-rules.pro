# release 包的 R8 规则（build.gradle：minifyEnabled + shrinkResources）。
# Capacitor 自带的消费者规则（@capacitor/android/capacitor/proguard-rules.pro）已保留所有 Plugin 子类、
# @PluginMethod / @PermissionCallback 等注解方法；capacitor.plugins.json 里按类名反射加载的插件也是 Plugin 子类。

# 本应用自己的代码很少，整体保留：插件方法、清单里声明的组件、反射与 JSON 字段都不受混淆影响
-keep class com.oa.suite.mobile.** { *; }

# WebView JS 桥接（MainActivity.ErrorPageBridge 等 addJavascriptInterface 对象）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# 崩溃堆栈保留行号；混淆映射 mapping.txt 由 pnpm mobile:publish 归档到 %USERPROFILE%/.oa-mobile/mappings/
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
