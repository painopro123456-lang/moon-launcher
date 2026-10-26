using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace MoonLauncher;

public partial class App : Application
{
    private static readonly string LogDirectory =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MoonLauncher");
    private static readonly string LogPath = Path.Combine(LogDirectory, "startup.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            LogException("AppDomain unhandled exception", args.ExceptionObject as Exception);

        DispatcherUnhandledException += (_, args) =>
        {
            LogException("WPF dispatcher unhandled exception", args.Exception);
            MessageBox.Show(
                "Moon Launcher encountered an error and could not continue.\n\nDetails were saved to:\n" + LogPath,
                "Moon Launcher startup error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            args.Handled = true;
            Shutdown(-1);
        };

        try
        {
            base.OnStartup(e);
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
        }
        catch (Exception ex)
        {
            LogException("Startup failed while creating the main window", ex);
            MessageBox.Show(
                "Moon Launcher could not start. The error was saved to:\n\n" + LogPath +
                "\n\nError: " + ex.Message,
                "Moon Launcher startup error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(-1);
        }
    }

    private static void LogException(string context, Exception? exception)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);
            File.AppendAllText(LogPath,
                $"[{DateTimeOffset.Now:O}] {context}{Environment.NewLine}" +
                (exception?.ToString() ?? "No exception details were available.") +
                Environment.NewLine + Environment.NewLine);
        }
        catch
        {
            // Startup diagnostics must never cause another startup failure.
        }
    }
}