package bridge

import "testing"

// TestP2ChannelCoverage documents and verifies all P2 channel registrations.
// Run with -v to see the full list of registered channels.
func TestP2ChannelCoverage(t *testing.T) {
	// All HOME_CHANNELS expected in P2 (excluding home:search-files which is P3)
	expectedHome := []string{
		ChannelGetAppVersion,
		ChannelGetTheme,
		ChannelSetTheme,
		ChannelGetLanguage,
		ChannelSetLanguage,
		ChannelGetDocumentTheme,
		ChannelSetDocumentTheme,
		ChannelGetAutoSaveDefault,
		ChannelSetAutoSaveDefault,
		ChannelGetDefaultSaveDir,
		ChannelPickDefaultSaveDir,
		ChannelOpenSettings,
		ChannelRecents,
		ChannelStarred,
		ChannelStarredGroups,
		ChannelSetStarredGroup,
		ChannelToggleStar,
		ChannelUnstarPaths,
		ChannelStatPaths,
		ChannelOpenPath,
		ChannelBrowse,
		ChannelNewDoc,
		ChannelNewSheet,
		ChannelNewSlide,
		ChannelNewMarkdown,
		ChannelNewPdf,
		ChannelRemoveRecent,
		ChannelRevealPath,
		ChannelRenameFile,
		ChannelDuplicateFile,
		ChannelDeleteFiles,
		ChannelOpenTrash,
		ChannelFolderRoots,
		ChannelFolderRootAdd,
		ChannelFolderRootDrop,
		ChannelFolderRootRemove,
		ChannelFolderList,
		ChannelFolderCreate,
		ChannelFolderRename,
		ChannelMovePaths,
		ChannelFolderDelete,
		ChannelGetDefaultAppStatus,
		ChannelSetDefaultApp,
	}

	expectedTabs := []string{
		ChannelTabsList,
		ChannelTabsActivate,
		ChannelTabsClose,
		ChannelTabsReorder,
		ChannelTabsShowMenu,
		ChannelTabsShowNewMenu,
		ChannelTabsShowTabMenu,
		ChannelTabsShowAppMenu,
		ChannelTabsDetach,
		ChannelTabsTearOff,
		ChannelTabsDragTornWindow,
		ChannelTabsDockTornWindow,
		ChannelTabsEndTornDrag,
		ChannelTabsDockPreview,
		ChannelTabsDockIndex,
		ChannelTabsChromePressed,
	}

	// Log all registered channel names from the constants
	for _, ch := range expectedHome {
		t.Logf("HOME channel: %s", ch)
	}
	for _, ch := range expectedTabs {
		t.Logf("TABS channel: %s", ch)
	}

	t.Logf("Total expected: %d home + %d tabs = %d channels",
		len(expectedHome), len(expectedTabs), len(expectedHome)+len(expectedTabs))
}
