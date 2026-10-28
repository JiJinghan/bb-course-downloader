import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let panel = NSOpenPanel()
panel.title = "选择课程资料文件夹"
panel.message = "选择已有课程文件夹，或点击“新建文件夹”。BB 下载助手只在你选定的目录归档资料。"
panel.prompt = "使用此文件夹"
panel.canChooseDirectories = true
panel.canChooseFiles = false
panel.canCreateDirectories = true
panel.allowsMultipleSelection = false
if CommandLine.arguments.count > 1 {
    panel.directoryURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
}
app.activate(ignoringOtherApps: true)
if panel.runModal() == .OK, let url = panel.url { print(url.path) }
