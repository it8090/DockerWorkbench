package workbench

import "testing"

func TestUpdatePreferencePersistence(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.SetPreference("updates.automatic", "false"); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	preferences, err := store.Preferences()
	if err != nil || preferences["updates.automatic"] != "false" {
		t.Fatalf("update preference did not survive restart: %v %v", preferences, err)
	}
	for _, invalid := range []string{"", "yes", "1", "TRUE"} {
		if err = store.SetPreference("updates.automatic", invalid); err == nil {
			t.Fatalf("accepted invalid update preference %q", invalid)
		}
	}
	if err = store.SetPreference("unrecognized.preference", "true"); err == nil {
		t.Fatal("accepted an unrecognized preference")
	}
	if err = store.SetPreference("updates.automatic", "true"); err != nil {
		t.Fatal(err)
	}
	preferences, err = store.Preferences()
	if err != nil || preferences["updates.automatic"] != "true" {
		t.Fatal("could not re-enable automatic checks")
	}
}
