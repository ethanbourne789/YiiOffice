package update

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// githubAsset keeps the table tests below readable.
type githubAsset = github.ReleaseAsset

// Sample digests: sha256("") and sha256("x").
const (
	emptySHA256 = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"
	otherSHA256 = "2D711642B726B04401627CA9FBAC32F5C8530FB1903CC4DB02258717921A4881"
)

func mustDigest(t *testing.T, hexDigest string) []byte {
	t.Helper()
	digest, err := hex.DecodeString(hexDigest)
	if err != nil {
		t.Fatalf("decode %q: %v", hexDigest, err)
	}
	return digest
}

func TestParseChecksumAcceptsBareDigest(t *testing.T) {
	const target = "YiiOffice_0.14.0_windows_amd64_setup.exe"
	want := mustDigest(t, emptySHA256)

	for name, body := range map[string]string{
		"plain":       emptySHA256,
		"newline":     emptySHA256 + "\n",
		"crlf":        emptySHA256 + "\r\n",
		"lowercase":   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		"whitespace":  "  " + emptySHA256 + "  \n",
		"utf8 bom":    "\uFEFF" + emptySHA256 + "\n",
		"blank lines": "\n\n" + emptySHA256 + "\n\n",
	} {
		t.Run(name, func(t *testing.T) {
			got, err := parseChecksum([]byte(body), target)
			if err != nil {
				t.Fatalf("parseChecksum: %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("digest = %x, want %x", got, want)
			}
		})
	}
}

func TestParseChecksumAcceptsSha256SumFormat(t *testing.T) {
	const target = "YiiOffice_0.14.0_windows_amd64_setup.exe"
	cases := []string{
		emptySHA256 + "  " + target,
		emptySHA256 + " *" + target,
		emptySHA256 + "  ./" + target,
	}
	for _, body := range cases {
		got, err := parseChecksum([]byte(body+"\n"), target)
		if err != nil {
			t.Fatalf("body %q: %v", body, err)
		}
		if !bytes.Equal(got, mustDigest(t, emptySHA256)) {
			t.Fatalf("body %q: digest = %x", body, got)
		}
	}
}

// A single entry is accepted even when its filename does not match: the digest
// still has to match the downloaded bytes, so a stale name after a release
// rename cannot produce a false accept.
func TestParseChecksumSingleEntryIgnoresFilename(t *testing.T) {
	got, err := parseChecksum([]byte(emptySHA256+"  SomeOtherInstaller.exe\n"), "target.exe")
	if err != nil {
		t.Fatalf("parseChecksum: %v", err)
	}
	if !bytes.Equal(got, mustDigest(t, emptySHA256)) {
		t.Fatalf("digest = %x", got)
	}
}

func TestParseChecksumSelectsEntryByFilename(t *testing.T) {
	const target = "YiiOffice_0.14.0_windows_amd64_setup.exe"
	body := "# published checksums\n" +
		otherSHA256 + "  YiiOffice_0.14.0_linux_amd64.tar.gz\n" +
		"\n" +
		emptySHA256 + " *" + target + "\n"

	got, err := parseChecksum([]byte(body), target)
	if err != nil {
		t.Fatalf("parseChecksum: %v", err)
	}
	if !bytes.Equal(got, mustDigest(t, emptySHA256)) {
		t.Fatalf("digest = %x", got)
	}
}

func TestParseChecksumRejectsUnmatchedMultiEntryFile(t *testing.T) {
	body := otherSHA256 + "  linux.tar.gz\n" + otherSHA256 + "  macos.zip\n"
	if _, err := parseChecksum([]byte(body), "windows_setup.exe"); err == nil {
		t.Fatal("expected an error when no entry names the target")
	}
}

func TestParseChecksumRejectsMalformedBodies(t *testing.T) {
	cases := map[string]string{
		"empty":         "",
		"comments only": "# nothing here\n",
		"not hex":       "not-a-digest  YiiOffice_setup.exe\n",
		"short":         "abc123  YiiOffice_setup.exe\n",
		"long":          emptySHA256 + "0  YiiOffice_setup.exe\n",
		"openssl form":  "SHA256 (YiiOffice_setup.exe) = " + emptySHA256 + "\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parseChecksum([]byte(body), "YiiOffice_setup.exe"); err == nil {
				t.Fatalf("body %q should be rejected", body)
			}
		})
	}
}

func TestFindChecksumAsset(t *testing.T) {
	artifact := "YiiOffice_0.14.0_windows_amd64_setup.exe"

	t.Run("exact match", func(t *testing.T) {
		assets := []githubAsset{
			{Name: artifact},
			{Name: artifact + ".sha256"},
			{Name: "other.exe.sha256"},
		}
		got, err := findChecksumAsset(assets, artifact)
		if err != nil {
			t.Fatalf("findChecksumAsset: %v", err)
		}
		if got == nil || got.Name != artifact+".sha256" {
			t.Fatalf("asset = %+v", got)
		}
	})

	t.Run("single candidate fallback", func(t *testing.T) {
		assets := []githubAsset{
			{Name: artifact},
			{Name: "YiiOffice_0.14.0_setup.exe.sha256"},
		}
		got, err := findChecksumAsset(assets, artifact)
		if err != nil {
			t.Fatalf("findChecksumAsset: %v", err)
		}
		if got == nil || got.Name != "YiiOffice_0.14.0_setup.exe.sha256" {
			t.Fatalf("asset = %+v", got)
		}
	})

	t.Run("none", func(t *testing.T) {
		got, err := findChecksumAsset([]githubAsset{{Name: artifact}}, artifact)
		if err != nil || got != nil {
			t.Fatalf("asset = %+v, err = %v", got, err)
		}
	})

	t.Run("ambiguous", func(t *testing.T) {
		assets := []githubAsset{{Name: "a.exe.sha256"}, {Name: "b.exe.sha256"}}
		if _, err := findChecksumAsset(assets, artifact); err == nil {
			t.Fatal("expected an ambiguity error")
		}
	})
}
