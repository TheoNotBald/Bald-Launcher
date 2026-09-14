using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;

namespace BaldLauncher.Native;

public partial class MainWindow : Window
{
    private readonly ObservableCollection<TextureEntry> _textures = new();
    private string _category = "All resources";

    public MainWindow()
    {
        InitializeComponent();
        CategoryList.ItemsSource = new[] { "All resources", "Blocks", "Items", "Entity Textures", "GUI Elements", "Particles", "Paintings" };
        CategoryList.SelectedIndex = 0;
        LoadReferenceCatalog();
    }

    private void LoadReferenceCatalog()
    {
        _textures.Clear();
        var entries = new[]
        {
            ("Acacia Planks", "Blocks", "acacia_planks.png"),
            ("Acacia Log", "Blocks", "acacia_log.png"),
            ("Stone", "Blocks", "stone.png"),
            ("Grass Block", "Blocks", "grass_block_top.png"),
            ("Diamond", "Items", "diamond.png"),
            ("Iron Sword", "Items", "iron_sword.png"),
            ("Notification 1", "GUI Elements", "notification/1.png"),
        };
        foreach (var entry in entries) _textures.Add(new TextureEntry(entry.Item1, entry.Item2, entry.Item3));
        RenderTextures();
    }

    private void RenderTextures()
    {
        var query = SearchBox?.Text?.Trim() ?? string.Empty;
        var visible = _textures.Where(texture =>
            (_category == "All resources" || texture.Category == _category) &&
            (query.Length == 0 || texture.Name.Contains(query, StringComparison.OrdinalIgnoreCase))).ToList();
        TextureGrid.Children.Clear();
        foreach (var texture in visible)
        {
            var button = new Button { Width = 145, Height = 100, Margin = new Thickness(0, 0, 10, 10), Tag = texture };
            var panel = new StackPanel();
            panel.Children.Add(new TextBlock { Text = "▦", FontSize = 28, HorizontalAlignment = HorizontalAlignment.Center, Foreground = System.Windows.Media.Brushes.LightGreen });
            panel.Children.Add(new TextBlock { Text = texture.Name, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
            panel.Children.Add(new TextBlock { Text = texture.Category, FontSize = 10, HorizontalAlignment = HorizontalAlignment.Center, Foreground = FindResource("SecondaryText") as System.Windows.Media.Brush });
            button.Content = panel;
            button.Click += Texture_Click;
            TextureGrid.Children.Add(button);
        }
        EmptyState.Visibility = visible.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TextureCount.Text = $"{visible.Count} texture{(visible.Count == 1 ? "" : "s")}";
    }

    private void Texture_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: TextureEntry texture })
        {
            StatusText.Text = $"Selected {texture.Name} · native editor surface is next";
        }
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        HomeView.Visibility = Visibility.Collapsed;
        BrowseView.Visibility = Visibility.Visible;
    }

    private void Home_Click(object sender, RoutedEventArgs e)
    {
        BrowseView.Visibility = Visibility.Collapsed;
        HomeView.Visibility = Visibility.Visible;
    }

    private void Refresh_Click(object sender, RoutedEventArgs e)
    {
        LoadReferenceCatalog();
        StatusText.Text = "Resource catalog refreshed";
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => RenderTextures();

    private void CategoryList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (CategoryList.SelectedItem is string category) _category = category;
        RenderTextures();
    }

    private sealed record TextureEntry(string Name, string Category, string AssetPath);
}