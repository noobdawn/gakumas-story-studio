using System;
using System.IO;
using UnityEngine;

// Both Players see the session directory. A handle is published only after the worker has finished writing.
public sealed class CreatorShotFrames : IDisposable {
    readonly string directory;
    Texture2D texture;
    byte[] pixels;
    string loaded;

    public CreatorShotFrames(string directory) { this.directory = directory; }

    string FramePath(string key) {
        if (directory == null || !Guid.TryParseExact(key, "N", out _)) throw new InvalidDataException("Invalid shot frame handle");
        return Path.Combine(directory, key + ".rgba");
    }
    void Size(int width, int height) {
        if (width < 16 || height < 16 || width > 1280 || height > 1280 || width * height > 921600)
            throw new InvalidDataException("Invalid shot frame dimensions");
        if (texture && texture.width == width && texture.height == height) return;
        Dispose();
        texture = new Texture2D(width, height, TextureFormat.RGBAHalf, false, true) {wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear};
    }
    public void Write(string key, RenderTexture world) {
        Size(world.width, world.height);
        var previous = RenderTexture.active;
        var resolved = RenderTexture.GetTemporary(world.width, world.height, 0, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
        try {
            Graphics.Blit(world, resolved);
            RenderTexture.active = resolved;
            texture.ReadPixels(new Rect(0, 0, world.width, world.height), 0, 0, false);
            using (var writer = new BinaryWriter(new FileStream(FramePath(key), FileMode.CreateNew, FileAccess.Write, FileShare.None))) {
                writer.Write(world.width);
                writer.Write(world.height);
                writer.Write(texture.GetRawTextureData());
            }
        } finally {RenderTexture.active = previous; RenderTexture.ReleaseTemporary(resolved);}
    }
    public Texture Read(string key) {
        if (string.IsNullOrEmpty(key)) return null;
        if (key == loaded) return texture;
        try {
            using (var reader = new BinaryReader(new FileStream(FramePath(key), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))) {
                int width = reader.ReadInt32(), height = reader.ReadInt32();
                Size(width, height);
                int size = width * height * 8;
                if (reader.BaseStream.Length != 8L + size) return null;
                if (pixels == null || pixels.Length != size) pixels = new byte[size];
                for (int n = 0; n < size;) {
                    int count = reader.Read(pixels, n, size - n);
                    if (count == 0) return null;
                    n += count;
                }
                texture.LoadRawTextureData(pixels);
                texture.Apply(false, false);
                loaded = key;
                return texture;
            }
        } catch (IOException) {return null;}
    }
    public void Dispose() {if (texture) UnityEngine.Object.Destroy(texture); texture = null; pixels = null; loaded = null;}
}
